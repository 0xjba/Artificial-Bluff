import { EventStore, type GameEvent } from '@ab/core'
import { CallingStation, MockLlm, RandomBot, TagBot, type Player } from '@ab/players'
import { describe, expect, it } from 'vitest'
import { parseStudyConfig, type StudyConfig } from '../src/config'
import { preregistration } from '../src/prereg'
import { BUDGET_CAP_REASON, readStoreProgress } from '../src/progress'
import { runStudy } from '../src/run'

const ids = ['jev', 'pill', 'block', 'drip', 'nimbus']

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

const run = (c: StudyConfig, players: Player[], store: EventStore, signal?: AbortSignal) =>
  runStudy({ config: c, players, store, prereg: preregistration(c, c.lineup), ...(signal ? { signal } : {}) })

const tags = () => ids.map((id) => new TagBot(id))

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
    expect(checks[1]!.players[0]).toMatchObject({ playerId: 'jev', bb100: 0, halfWidth: 0 })
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
    const players = [new TagBot('jev'), new CallingStation('pill'), new RandomBot('block', 1), new TagBot('drip'), new CallingStation('nimbus')]
    const out = await run(config({ targetHalfWidthBb100: 0.001 }), players, store)
    expect(out.reason).toBe('max_groups')
    expect(out.groupsCompleted).toBe(16)
    expect(out.summary).toMatchObject({ groups: 16, blocks: 4 })
    expect(out.summary.players.reduce((s, p) => s + p.bb100.mean, 0)).toBeCloseTo(0, 6) // zero-sum
    const last = store.events('pilot').at(-1)!
    expect(last).toMatchObject({ type: 'study_ended', reason: 'max_groups', groupsCompleted: 16, handsPlayed: 80 })
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
    const mixed = () => [new TagBot('jev'), new CallingStation('pill'), new MockLlm('block'), new TagBot('drip'), new CallingStation('nimbus')]
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

  it('pre-registers everything that affects results, but not budget or concurrency', () => {
    const c = config()
    const record = preregistration(c, c.lineup) as { study: Record<string, unknown>; prompts: Record<string, string> }
    expect(record.study).not.toHaveProperty('budgetUsd')
    expect(record.study).not.toHaveProperty('concurrency')
    expect(record.study).toMatchObject({ masterSeed: 'm', targetHalfWidthBb100: 1000, decisionTimeoutMs: 1000 })
    expect(record.prompts.llmSystem).toContain('win this hand')
  })
})
