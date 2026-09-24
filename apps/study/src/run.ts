import { configHash, playHand, type EventStore, type StudyEndReason } from '@ab/core'
import { cashHandConfig, duplicateGroup, type DuplicateHand } from '@ab/engine'
import type { Player } from '@ab/players'
import type { StudyConfig } from './config'
import { assertPreregMatches } from './prereg'
import { completedPrefix, handKeyOf, readStoreProgress, type StudyProgress } from './progress'
import { summarize, type StudySummary } from './results'

export interface RunStudyOptions {
  config: StudyConfig
  /** Players for the line-up, in any order (matched by id). */
  players: Player[]
  store: EventStore
  /** The pre-registration record of `config` (see `preregistration`); its hash must not change across resumes. */
  prereg: Record<string, unknown>
  /** Stops scheduling new hands; hands in flight finish. */
  signal?: AbortSignal
  /** Run a study left marked 'running' (a crash). Never while another process is running it. */
  takeover?: boolean
  /** Called each time the stopping rule is checked. */
  onCheckpoint?: (summary: StudySummary, costUsd: number) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface StudyOutcome {
  reason: StudyEndReason
  /** Completed prefix of groups (before truncating to whole blocks). */
  groupsCompleted: number
  /** Results over the analysed groups (see the study_ended event's analysedGroups). */
  summary: StudySummary
  costUsd: number
  configHash: string
}

/**
 * Runs (or resumes) a duplicate study. Hands are played in group order by `concurrency` workers.
 * Results always use the completed prefix of groups in whole neighbour blocks, so the stopping rule
 * can't pick favourable groups. The rule is checked at every boundary (each multiple of checkEvery,
 * and maxGroups) in order, so where a study stops depends only on the data, never on concurrency or
 * on where a run was interrupted. Hands cut short by the budget cap don't count and are replayed
 * (as a new attempt) when the study is resumed with more budget.
 */
export async function runStudy(opts: RunStudyOptions): Promise<StudyOutcome> {
  const { config, store } = opts
  const n = config.lineup.length
  const players = new Map(opts.players.map((p) => [p.id, p]))
  for (const spec of config.lineup) if (!players.has(spec.id)) throw new Error(`no player for line-up seat ${spec.id}`)
  const ids = config.lineup.map((s) => s.id)
  assertPreregMatches(opts.prereg, config)

  const hash = configHash(opts.prereg)
  const existing = store.game(config.id)
  if (existing) {
    if (existing.kind !== 'study') throw new Error(`${config.id} is not a study`)
    if (existing.configHash !== hash) throw new Error(`study ${config.id} was pre-registered with a different config (hash ${existing.configHash.slice(0, 12)}…); use a new id`)
  }
  const finished = (q: StudyProgress): StudyOutcome | null =>
    q.lastEnd === 'ci_target' || q.lastEnd === 'max_groups'
      ? { reason: q.lastEnd, groupsCompleted: completedPrefix(q, n, config.maxGroups), summary: summarize(q, config, q.analysedGroups!), costUsd: store.gameCost(config.id), configHash: hash }
      : null
  if (existing) {
    const done = finished(readStoreProgress(store, config.id))
    if (done) return done
    store.claimGame(config.id, opts.takeover)
  } else {
    store.createGame(config.id, 'study', opts.prereg)
  }
  // Read progress only once we hold the study, so it can't be stale (another run may have just ended).
  const p = readStoreProgress(store, config.id)
  const done = finished(p)
  if (done) {
    store.setStatus(config.id, 'ended')
    return done
  }
  const sink = store.sink(config.id)
  sink.append({ type: 'game_started', kind: 'study', configHash: hash, players: ids.map((id) => players.get(id)!).map((pl) => ({ id: pl.id, kind: pl.kind, model: pl.model })) })

  const overBudget = () => store.gameCost(config.id) >= config.budgetUsd
  let stop: StudyEndReason | null = null
  let failure: unknown = null
  // Resume the check schedule after the last logged check; a met rule that was logged but never
  // reached study_ended (crash) still ends the study.
  let checkedAt = p.lastCheckpoint?.groups ?? 0
  let stopAt: number | null = p.lastCheckpoint?.stop ? p.lastCheckpoint.groups : null
  if (stopAt !== null) stop = 'ci_target'

  /** Checks the rule at every boundary the completed prefix has reached, in order; stops at the first met. */
  function checkpoints(): void {
    const prefix = completedPrefix(p, n, config.maxGroups)
    while (stopAt === null) {
      const boundary = Math.min(checkedAt + config.checkEvery, config.maxGroups)
      if (boundary <= checkedAt || boundary > prefix) return
      checkedAt = boundary
      const summary = summarize(p, config, boundary)
      const costUsd = store.gameCost(config.id)
      const met = boundary >= config.minGroups && summary.players.every((pl) => pl.bb100.halfWidth <= config.targetHalfWidthBb100)
      const finite = (x: number) => (Number.isFinite(x) ? x : null)
      sink.append({
        type: 'study_checkpoint',
        groups: boundary,
        blocks: summary.blocks,
        costUsd,
        players: summary.players.map((pl) => ({
          playerId: pl.playerId,
          bb100: finite(pl.bb100.mean),
          low: finite(pl.bb100.low),
          high: finite(pl.bb100.high),
          halfWidth: finite(pl.bb100.halfWidth),
        })),
        stop: met,
      })
      opts.onCheckpoint?.(summary, costUsd)
      if (met) {
        stopAt = boundary
        // Decided by the data, so it takes precedence over a budget cap or an interruption.
        stop = 'ci_target'
      }
    }
  }
  checkpoints() // catch up on checks a crash skipped

  function* tasks(): Generator<DuplicateHand> {
    for (let g = 0; g < config.maxGroups; g++) {
      for (const hand of duplicateGroup(config.masterSeed, g, ids)) {
        if (!p.valid.has(handKeyOf(hand.groupIndex, hand.rotation))) yield hand
      }
    }
  }
  const queue = tasks()

  async function worker(): Promise<void> {
    for (;;) {
      // Let signal handlers (Ctrl-C) run even when every player answers instantly (mocks, bots).
      await new Promise<void>((resolve) => setImmediate(resolve))
      if (stop) return
      if (opts.signal?.aborted) {
        stop = 'interrupted'
        return
      }
      if (overBudget()) {
        stop = 'budget_cap'
        return
      }
      const next = queue.next()
      if (next.done) return
      const hand = next.value
      const key = handKeyOf(hand.groupIndex, hand.rotation)
      const attempt = (p.attempts.get(key) ?? 0) + 1
      p.attempts.set(key, attempt)
      let capped = false
      try {
        const result = await playHand({
          config: { ...cashHandConfig(hand, config.format), handId: `${key}#${attempt}` },
          duplicate: { groupIndex: hand.groupIndex, rotation: hand.rotation, order: hand.order, seed: hand.seed, attempt },
          players,
          sink,
          decisionTimeoutMs: config.decisionTimeoutMs,
          ...(config.handFacts ? { handFacts: true } : {}),
          stopSpending: () => {
            if (overBudget()) capped = true
            return capped
          },
          ...(opts.now ? { now: opts.now } : {}),
          ...(opts.sleep ? { sleep: opts.sleep } : {}),
        })
        p.handsPlayed++
        if (!capped) {
          p.valid.set(key, result.net)
          p.validHandIds.set(key, `${key}#${attempt}`)
        }
        checkpoints()
      } catch (e) {
        failure ??= e
        stop ??= 'interrupted'
        return
      }
    }
  }

  await Promise.all(Array.from({ length: config.concurrency }, () => worker()))
  const groupsCompleted = completedPrefix(p, n, config.maxGroups)
  const reason: StudyEndReason = stop ?? (groupsCompleted >= config.maxGroups ? 'max_groups' : 'interrupted')
  const summary = summarize(p, config, stopAt ?? groupsCompleted)
  const costUsd = store.gameCost(config.id)
  sink.append({ type: 'study_ended', reason, groupsCompleted, analysedGroups: summary.groups, handsPlayed: p.handsPlayed, costUsd })
  store.setStatus(config.id, reason === 'interrupted' ? 'interrupted' : 'ended')
  if (failure) throw failure
  return { reason, groupsCompleted, summary, costUsd, configHash: hash }
}
