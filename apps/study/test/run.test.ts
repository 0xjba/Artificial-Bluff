import { EventStore, type EventBody, type GameEvent } from '@ab/core'
import { CallingStation, MockLlm, RandomBot, TagBot, type Player } from '@ab/players'
import { describe, expect, it } from 'vitest'
import { parseStudyConfig, type StudyConfig } from '../src/config'
import { preregistration } from '../src/prereg'
import { BUDGET_CAP_REASON, emptyProgress, handKeyOf, readProgress, readStoreProgress } from '../src/progress'
import { summarize } from '../src/results'
import { runStudy } from '../src/run'

const ids = ['hex', 'pill', 'block', 'drip', 'nimbus']

function config(over: Record<string, unknown> = {}): StudyConfig {
  return parseStudyConfig({
    id: 'pilot',
    lineup: ids.map((id) => ({ id, kind: 'mock' })),
    masterSeed: 'm',
    budgetUsd: 100,
    targetHalfWidthBb100: 1000,
    // Fixed size (min == max) unless a test overrides: the CI rule then only fires at the end.
    minGroups: 16,
    maxGroups: 16,
    checkEvery: 4,
    concurrency: 1,
    bootstrapResamples: 1000,
    decisionTimeoutMs: 1000,
    ...over,
  })
}

const run = (c: StudyConfig, players: Player[], store: EventStore, signal?: AbortSignal, takeover?: boolean) =>
  runStudy({ config: c, players, store, prereg: preregistration(c, c.lineup), ...(signal ? { signal } : {}), ...(takeover ? { takeover } : {}) })

const tags = () => ids.map((id) => new TagBot(id))
const mixed = () => [new TagBot('hex'), new CallingStation('pill'), new MockLlm('block'), new TagBot('drip'), new CallingStation('nimbus')]

type Of<T extends GameEvent['type']> = Extract<GameEvent, { type: T }>
const eventsOf = <T extends GameEvent['type']>(store: EventStore, type: T) => store.events('pilot').filter((e): e is Of<T> => e.type === type)
const checks = (store: EventStore) => eventsOf(store, 'study_checkpoint').map((c) => [c.groups, c.stop])

/** Calls `trip` on the player's `after`-th decision (to interrupt a run mid-way). */
function tripwire(p: Player, after: number, trip: () => void): Player {
  let calls = 0
  return { id: p.id, kind: p.kind, model: p.model, decide: (obs, signal) => (++calls === after && trip(), p.decide(obs, signal)) }
}

/** Answers after a varying delay (deterministic), so parallel tables finish out of order. */
function jitter(p: Player): Player {
  let calls = 0
  return {
    id: p.id,
    kind: p.kind,
    model: p.model,
    decide: async (obs, signal) => {
      await new Promise((r) => setTimeout(r, (++calls * 7) % 5))
      return p.decide(obs, signal)
    },
  }
}

/** Copies a study's events, minus those `drop` rejects, into a new store left 'running' (a crash). */
function crashCopy(from: EventStore, drop: (e: GameEvent, i: number, all: GameEvent[]) => boolean): EventStore {
  const to = new EventStore()
  to.createGame('pilot', 'study', from.game('pilot')!.config)
  const all = from.events('pilot')
  all.forEach((e, i) => {
    if (drop(e, i, all)) return
    const { gameId: _g, seq: _s, ts: _t, ...body } = e
    to.append('pilot', body as EventBody)
  })
  return to
}

describe('runStudy', () => {
  it('duplicate play cancels luck: identical players break exactly even', async () => {
    const store = new EventStore()
    const out = await run(config({ targetHalfWidthBb100: 0.001 }), tags(), store)
    expect(out.reason).toBe('ci_target') // every CI is exactly [0, 0]
    expect(out.groupsCompleted).toBe(16)
    for (const p of out.summary.players) expect(p.bb100).toMatchObject({ mean: 0, halfWidth: 0 })
  })

  it('never stops on the CI before minGroups, and logs every check', async () => {
    const store = new EventStore()
    const out = await run(config({ minGroups: 40, maxGroups: 80, checkEvery: 20, targetHalfWidthBb100: 0.001 }), tags(), store)
    expect(out.reason).toBe('ci_target')
    expect(out.groupsCompleted).toBe(40) // CI was already 0-wide at 20 groups, but 40 is the minimum
    const checks = store.events('pilot').filter((e): e is Extract<GameEvent, { type: 'study_checkpoint' }> => e.type === 'study_checkpoint')
    expect(checks.map((c) => [c.groups, c.stop])).toEqual([
      [20, false],
      [40, true],
    ])
    expect(checks[1]!.players[0]).toMatchObject({ playerId: 'hex', bb100: 0, halfWidth: 0 })
  })

  it('records the duplicate schedule on every hand', async () => {
    const store = new EventStore()
    await run(config({ maxGroups: 4, minGroups: 4 }), tags(), store)
    const starts = store.events('pilot').filter((e): e is Extract<GameEvent, { type: 'hand_started' }> => e.type === 'hand_started')
    expect(starts).toHaveLength(20)
    expect(starts[0]).toMatchObject({ handId: '0:0#1', duplicate: { groupIndex: 0, rotation: 0, attempt: 1, order: 1 } })
    expect(new Set(starts.map((s) => s.handId)).size).toBe(20)
  })

  it('plays every group up to maxGroups when the CI target is out of reach', async () => {
    const store = new EventStore()
    const players = [new TagBot('hex'), new CallingStation('pill'), new RandomBot('block', 1), new TagBot('drip'), new CallingStation('nimbus')]
    const out = await run(config({ targetHalfWidthBb100: 0.001 }), players, store)
    expect(out.reason).toBe('max_groups')
    expect(out.groupsCompleted).toBe(16)
    expect(out.summary).toMatchObject({ groups: 16, blocks: 4 })
    expect(out.summary.players.reduce((s, p) => s + p.bb100.mean, 0)).toBeCloseTo(0, 6) // zero-sum
    const last = store.events('pilot').at(-1)!
    expect(last).toMatchObject({ type: 'study_ended', reason: 'max_groups', groupsCompleted: 16, analysedGroups: 16, handsPlayed: 80 })
  })

  it('stops at the budget cap, excludes cut-off hands, and replays them when resumed with more budget', async () => {
    const store = new EventStore()
    // Paid mock seats plus two calling stations, so results vary and the CI can't close early.
    const pricey = () => ids.map((id, i) => (i < 3 ? new MockLlm(id, 'mock/pricey', { inputPricePerMTok: 50 }) : new CallingStation(id)))
    const first = await run(config({ budgetUsd: 2, targetHalfWidthBb100: 0.001 }), pricey(), store)
    expect(first.reason).toBe('budget_cap')
    const capped = store.events('pilot').filter((e) => e.type === 'decision' && e.fallbackReason === BUDGET_CAP_REASON)
    expect(capped.length).toBeGreaterThan(0)
    const before = readStoreProgress(store, 'pilot')
    expect(before.valid.size).toBeLessThan(before.attempts.size) // at least one started hand doesn't count

    // Top up: same pre-registration (budget isn't hashed), so the study resumes.
    const second = await run(config({ budgetUsd: 50, targetHalfWidthBb100: 0.001 }), pricey(), store)
    expect(second.reason).toBe('max_groups')
    expect(second.configHash).toBe(first.configHash)
    const after = readStoreProgress(store, 'pilot')
    expect(after.valid.size).toBe(80)
    expect([...after.attempts.values()].some((a) => a > 1)).toBe(true) // a cut-off hand was replayed
  })

  it('refuses to resume with a different pre-registration', async () => {
    const store = new EventStore()
    await run(config({ maxGroups: 4, minGroups: 4 }), tags(), store)
    await expect(run(config({ maxGroups: 4, minGroups: 4, masterSeed: 'other' }), tags(), store)).rejects.toThrow(/different config/)
  })

  it('does nothing more once a study has finished', async () => {
    const store = new EventStore()
    await run(config({ maxGroups: 4, minGroups: 4 }), tags(), store)
    const count = store.events('pilot').length
    const again = await run(config({ maxGroups: 4, minGroups: 4 }), tags(), store)
    expect(again.reason).toBe('max_groups')
    expect(store.events('pilot')).toHaveLength(count)
  })

  it('gives the same results with parallel tables as with one', async () => {
    const a = await run(config({ concurrency: 1 }), mixed(), new EventStore())
    const b = await run(config({ concurrency: 4 }), mixed(), new EventStore())
    expect(b.summary.players.map((p) => p.bb100.mean)).toEqual(a.summary.players.map((p) => p.bb100.mean))
  })

  it('stops as interrupted when aborted, and can be resumed', async () => {
    const store = new EventStore()
    const ac = new AbortController()
    ac.abort()
    const first = await run(config(), tags(), store, ac.signal)
    expect(first.reason).toBe('interrupted')
    expect(store.game('pilot')!.status).toBe('interrupted')
    const second = await run(config(), tags(), store) // same pre-registration
    expect(second.reason).toBe('ci_target')
  })

  // Two whole studies, one of them sixteen tables at once: slow enough to need its own headroom when
  // the workspace runs every package's tests together.
  it('checks the stopping rule at the same boundaries whatever the concurrency', { timeout: 30_000 }, async () => {
    // A fixed-size study (min == max), so the schedule is the whole run and neither concurrency stops early.
    const c = { minGroups: 40, maxGroups: 40, checkEvery: 8, targetHalfWidthBb100: 0.001 }
    const one = new EventStore()
    const many = new EventStore()
    const a = await run(config({ ...c, concurrency: 1 }), mixed(), one)
    const b = await run(config({ ...c, concurrency: 16 }), mixed().map(jitter), many)
    expect(checks(one)).toEqual(Array.from({ length: 5 }, (_, i) => [8 * (i + 1), false]))
    expect(checks(many)).toEqual(checks(one))
    expect(b.reason).toBe(a.reason)
    expect(b.summary).toEqual(a.summary)
  })

  it('resumes the check schedule where it left off', async () => {
    const store = new EventStore()
    const ac = new AbortController()
    const players = tags().map((p, i) => (i === 0 ? tripwire(p, 28, () => ac.abort()) : p))
    const c = config({ checkEvery: 8 })
    const first = await run(c, players, store, ac.signal)
    expect(first.reason).toBe('interrupted')
    expect(first.groupsCompleted).toBeGreaterThan(4) // past a block, short of the first check at 8
    expect(first.groupsCompleted).toBeLessThan(8)
    const second = await run(c, tags(), store)
    expect(second.reason).toBe('ci_target')
    expect(checks(store)).toEqual([[8, false], [16, true]])
  })

  it('ends a study whose stopping rule was met before a crash, without playing on', async () => {
    const done = new EventStore()
    await run(config({ targetHalfWidthBb100: 0.001 }), tags(), done)
    // Crash after the met check was logged, before study_ended.
    const crashed = crashCopy(done, (e) => e.type === 'study_ended')
    await expect(run(config({ targetHalfWidthBb100: 0.001 }), tags(), crashed)).rejects.toThrow(/already running/)
    const hands = eventsOf(crashed, 'hand_started').length
    const out = await run(config({ targetHalfWidthBb100: 0.001 }), tags(), crashed, undefined, true)
    expect(out.reason).toBe('ci_target')
    expect(eventsOf(crashed, 'hand_started')).toHaveLength(hands)
    expect(crashed.events('pilot').at(-1)).toMatchObject({ type: 'study_ended', reason: 'ci_target', analysedGroups: 16 })
    const rerun = await run(config({ targetHalfWidthBb100: 0.001 }), tags(), crashed) // finished: reads, plays nothing
    expect(rerun).toMatchObject({ reason: 'ci_target', summary: { groups: 16 } })
    expect(crashed.game('pilot')!.status).toBe('ended')
    // Crash after the last hand, before its check was logged: the check is caught up on resume.
    const early = crashCopy(done, (e, i, all) => e.type === 'study_ended' || (e.type === 'study_checkpoint' && i === all.length - 2))
    const again = await run(config({ targetHalfWidthBb100: 0.001 }), tags(), early, undefined, true)
    expect(again.reason).toBe('ci_target')
    expect(checks(early)).toEqual([[4, false], [8, false], [12, false], [16, true]])
  })

  it('refuses a pre-registration made for a different config', async () => {
    const c = config()
    await expect(runStudy({ config: c, players: tags(), store: new EventStore(), prereg: preregistration(config({ minGroups: 8, maxGroups: 8 }), c.lineup) })).rejects.toThrow(/not for study config/)
    expect(() => preregistration(c, c.lineup, { study: {} })).toThrow(/overwrite/)
  })

  it('deals every rotation of a group the same cards, and seats each player once in each seat', async () => {
    const store = new EventStore()
    await run(config({ maxGroups: 4, minGroups: 4 }), tags(), store)
    const starts = eventsOf(store, 'hand_started')
    const dealt = new Map(eventsOf(store, 'cards_dealt').map((e) => [e.handId, e.holes]))
    for (let g = 0; g < 4; g++) {
      const group = starts.filter((s) => s.duplicate!.groupIndex === g)
      expect(group).toHaveLength(5)
      expect(new Set(group.map((s) => s.duplicate!.seed)).size).toBe(1)
      const bySeat = group.map((s) => s.seats.map((seat) => dealt.get(s.handId)![seat.playerId]!.join('')))
      for (const cards of bySeat.slice(1)) expect(cards).toEqual(bySeat[0]) // seat i gets the same hole cards
      for (let seat = 0; seat < 5; seat++) expect(new Set(group.map((s) => s.seats[seat]!.playerId)).size).toBe(5)
    }
  })

  it('pre-registers everything that affects results, but not budget or concurrency', () => {
    const c = config()
    const record = preregistration(c, c.lineup) as { study: Record<string, unknown>; prompts: Record<string, string>; jevMove: string }
    expect(record.study).not.toHaveProperty('budgetUsd')
    expect(record.study).not.toHaveProperty('concurrency')
    expect(record.study).toMatchObject({ masterSeed: 'm', targetHalfWidthBb100: 1000, decisionTimeoutMs: 1000 })
    expect(record.prompts.llmSystem).toContain('win this hand')
    // How Jev's probabilities become a move is part of the protocol, not a detail of the code.
    expect(record.jevMove).toContain('total weight')
  })
})

describe('study results and progress', () => {
  it('computes bb/100 per group from the nets, averaged over whole neighbour blocks', () => {
    const c = config({ minGroups: 8, maxGroups: 8 })
    const p = emptyProgress()
    // Group g: jev wins (g + 1) big blinds from pill in every rotation, so hex's group bb/100 is 100 (g + 1).
    for (let g = 0; g < 8; g++) for (let r = 0; r < 5; r++) p.valid.set(handKeyOf(g, r), { hex: (g + 1) * 100, pill: -(g + 1) * 100 })
    const full = summarize(p, c, 8)
    expect(full).toMatchObject({ groups: 8, blocks: 2 })
    const hex = full.players[0]!
    expect(hex.bb100.mean).toBeCloseTo(450, 9) // blocks: 250 and 650
    expect(hex.bb100.halfWidth).toBeCloseTo(12.7062047 * 200, 3) // t(0.975, 1) x sd 282.84 / sqrt 2
    expect(hex.hands).toBe(40)
    expect(full.players[1]!.bb100.mean).toBeCloseTo(-450, 9)
    expect(full.players[2]!.bb100.mean).toBe(0)
    const partial = summarize(p, c, 7) // only the first whole block
    expect(partial).toMatchObject({ groups: 4, blocks: 1 })
    expect(partial.players[0]!.bb100).toMatchObject({ mean: 250, halfWidth: Infinity })
  })

  it('counts a hand once when a crash cut its first attempt short', () => {
    const e = (body: Record<string, unknown>) => ({ gameId: 'pilot', seq: 0, ts: 0, ...body }) as GameEvent
    const dup = (attempt: number) => ({ groupIndex: 0, rotation: 0, order: 1, seed: 7, attempt })
    const p = readProgress([
      e({ type: 'hand_started', handId: '0:0#1', duplicate: dup(1) }),
      e({ type: 'hand_started', handId: '0:0#2', duplicate: dup(2) }),
      e({ type: 'hand_ended', handId: '0:0#2', net: { hex: 5 }, stacks: {} }),
      e({ type: 'study_checkpoint', groups: 4, blocks: 1, costUsd: 0, players: [], stop: false }),
    ])
    expect(p.attempts.get('0:0')).toBe(2)
    expect(p.valid.get('0:0')).toEqual({ hex: 5 })
    expect(p.handsPlayed).toBe(1)
    expect(p.lastCheckpoint).toEqual({ groups: 4, stop: false })
  })
})
