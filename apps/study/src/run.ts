import { configHash, playHand, type EventStore, type StudyEndReason } from '@ab/core'
import { cashHandConfig, duplicateGroup, type DuplicateHand } from '@ab/engine'
import type { Player } from '@ab/players'
import type { StudyConfig } from './config'
import { BUDGET_CAP_REASON, completedPrefix, handKeyOf, readStoreProgress } from './progress'
import { summarize, type StudySummary } from './results'

export interface RunStudyOptions {
  config: StudyConfig
  /** Players for the line-up, in any order (matched by id). */
  players: Player[]
  store: EventStore
  /** The pre-registration record (see `preregistration`); its hash must not change across resumes. */
  prereg: Record<string, unknown>
  /** Stops scheduling new hands; hands in flight finish. */
  signal?: AbortSignal
  /** Called each time the stopping rule is checked. */
  onCheckpoint?: (summary: StudySummary, costUsd: number) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface StudyOutcome {
  reason: StudyEndReason
  /** Completed prefix of groups (before truncating to whole blocks). */
  groupsCompleted: number
  summary: StudySummary
  costUsd: number
  configHash: string
}

/**
 * Runs (or resumes) a duplicate study. Hands are played in group order by `concurrency` workers.
 * Results always use the completed prefix of groups in whole neighbour blocks, so the stopping rule
 * can't pick favourable groups. Hands cut short by the budget cap don't count and are replayed
 * (as a new attempt) when the study is resumed with more budget.
 */
export async function runStudy(opts: RunStudyOptions): Promise<StudyOutcome> {
  const { config, store } = opts
  const n = config.lineup.length
  const players = new Map(opts.players.map((p) => [p.id, p]))
  for (const spec of config.lineup) if (!players.has(spec.id)) throw new Error(`no player for line-up seat ${spec.id}`)
  const ids = config.lineup.map((s) => s.id)

  const hash = configHash(opts.prereg)
  const existing = store.game(config.id)
  if (existing) {
    if (existing.kind !== 'study') throw new Error(`${config.id} is not a study`)
    if (existing.configHash !== hash) throw new Error(`study ${config.id} was pre-registered with a different config (hash ${existing.configHash.slice(0, 12)}…); use a new id`)
  } else {
    store.createGame(config.id, 'study', opts.prereg)
  }
  const progress = readStoreProgress(store, config.id)
  const summaryNow = () => summarize(progress, config, completedPrefix(progress, n, config.maxGroups))
  if (progress.lastEnd === 'ci_target' || progress.lastEnd === 'max_groups') {
    return { reason: progress.lastEnd, groupsCompleted: completedPrefix(progress, n, config.maxGroups), summary: summaryNow(), costUsd: store.gameCost(config.id), configHash: hash }
  }
  if (existing) store.setStatus(config.id, 'running')
  const sink = store.sink(config.id)
  sink.append({ type: 'game_started', kind: 'study', configHash: hash, players: opts.players.map((p) => ({ id: p.id, kind: p.kind, model: p.model })) })

  const overBudget = () => store.gameCost(config.id) >= config.budgetUsd
  let stop: StudyEndReason | null = null
  let failure: unknown = null
  let checkedAt = completedPrefix(progress, n, config.maxGroups)

  function checkpoint(): void {
    const prefix = completedPrefix(progress, n, config.maxGroups)
    if (prefix < checkedAt + config.checkEvery && prefix < config.maxGroups) return
    checkedAt = prefix - (prefix % config.checkEvery)
    const summary = summarize(progress, config, prefix)
    const costUsd = store.gameCost(config.id)
    const met = prefix >= config.minGroups && summary.players.every((p) => p.bb100.halfWidth <= config.targetHalfWidthBb100)
    const finite = (x: number) => (Number.isFinite(x) ? x : null)
    sink.append({
      type: 'study_checkpoint',
      groups: summary.groups,
      blocks: summary.blocks,
      costUsd,
      players: summary.players.map((p) => ({
        playerId: p.playerId,
        bb100: finite(p.bb100.mean),
        low: finite(p.bb100.low),
        high: finite(p.bb100.high),
        halfWidth: finite(p.bb100.halfWidth),
      })),
      stop: met && stop === null,
    })
    opts.onCheckpoint?.(summary, costUsd)
    if (met) stop ??= 'ci_target'
  }

  function* tasks(): Generator<DuplicateHand> {
    for (let g = 0; g < config.maxGroups; g++) {
      for (const hand of duplicateGroup(config.masterSeed, g, ids)) {
        if (!progress.valid.has(handKeyOf(hand.groupIndex, hand.rotation))) yield hand
      }
    }
  }
  const queue = tasks()

  async function worker(): Promise<void> {
    for (;;) {
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
      const attempt = (progress.attempts.get(key) ?? 0) + 1
      progress.attempts.set(key, attempt)
      let capped = false
      try {
        const result = await playHand({
          config: { ...cashHandConfig(hand, config.format), handId: `${key}#${attempt}` },
          duplicate: { groupIndex: hand.groupIndex, rotation: hand.rotation, order: hand.order, seed: hand.seed, attempt },
          players,
          sink,
          decisionTimeoutMs: config.decisionTimeoutMs,
          stopSpending: () => {
            if (overBudget()) capped = true
            return capped
          },
          ...(opts.now ? { now: opts.now } : {}),
          ...(opts.sleep ? { sleep: opts.sleep } : {}),
        })
        progress.handsPlayed++
        if (!capped) progress.valid.set(key, result.net)
        checkpoint()
      } catch (e) {
        failure ??= e
        stop = 'interrupted'
        return
      }
    }
  }

  await Promise.all(Array.from({ length: config.concurrency }, () => worker()))
  const groupsCompleted = completedPrefix(progress, n, config.maxGroups)
  const reason: StudyEndReason = stop ?? (groupsCompleted >= config.maxGroups ? 'max_groups' : 'interrupted')
  const costUsd = store.gameCost(config.id)
  sink.append({ type: 'study_ended', reason, groupsCompleted, handsPlayed: progress.handsPlayed, costUsd })
  store.setStatus(config.id, reason === 'interrupted' ? 'interrupted' : 'ended')
  if (failure) throw failure
  return { reason, groupsCompleted, summary: summaryNow(), costUsd, configHash: hash }
}
