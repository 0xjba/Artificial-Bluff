import { EventStore } from '@ab/core'
import { CallingStation, MockLlm, TagBot, type Player } from '@ab/players'
import { describe, expect, it } from 'vitest'
import { parseStudyConfig, type StudyConfig } from '../src/config'
import { decisionsCsv } from '../src/exports'
import { preregistration } from '../src/prereg'
import { analyseStudy, focusPlayer, studyHands } from '../src/report'
import { runStudy } from '../src/run'

const ids = ['jev', 'pill', 'block', 'drip', 'nimbus']

function config(over: Record<string, unknown> = {}): StudyConfig {
  return parseStudyConfig({
    id: 'r',
    lineup: ids.map((id) => ({ id, kind: 'mock' })),
    masterSeed: 'm',
    budgetUsd: 100,
    targetHalfWidthBb100: 0.001,
    minGroups: 8,
    maxGroups: 8,
    checkEvery: 4,
    bootstrapResamples: 1000,
    decisionTimeoutMs: 1000,
    ...over,
  })
}

const mixed = (): Player[] => [new MockLlm('jev', 'mock/jev'), new TagBot('pill'), new CallingStation('block'), new MockLlm('drip', 'mock/drip'), new CallingStation('nimbus')]
const run = (c: StudyConfig, players: Player[], store: EventStore) => runStudy({ config: c, players, store, prereg: preregistration(c, c.lineup) })
const at = '2026-09-22T00:00:00.000Z'

describe('study report', () => {
  it('analyses exactly the hands behind the published results', async () => {
    const store = new EventStore()
    const c = config()
    const outcome = await run(c, mixed(), store)
    const { report, decisions } = analyseStudy(store, c, { focusId: 'jev', generatedAt: at })
    expect(report.study).toMatchObject({ id: 'r', analysedGroups: 8, blocks: 2, hands: 40, endReason: outcome.reason, status: 'ended', configHash: outcome.configHash })
    expect(report.results).toEqual(outcome.summary.players)
    expect(report.contrasts.map((x) => x.otherId)).toEqual(['pill', 'block', 'drip', 'nimbus'])
    expect(report.players[0]).toMatchObject({ playerId: 'jev', kind: 'mock', model: 'mock/jev', answeredModels: ['mock/jev'] })
    expect(report.metrics.map((m) => m.hands)).toEqual([40, 40, 40, 40, 40])
    expect(decisions.length).toBe(report.study.decisions)
    // Mock seats state win probabilities, so both calibration charts have data; calling stations state none.
    const jevCal = report.calibration[0]!
    expect(jevCal.winA.n).toBeGreaterThan(0)
    expect(jevCal.winC.n).toBe(jevCal.winA.n)
    expect(jevCal.confidenceSource).toMatch(/mock/)
    expect(report.calibration[2]!.winA.n).toBe(0)
    // Chips are conserved in every analysed hand, so bb/100 sums to zero.
    expect(report.results.reduce((s, r) => s + r.bb100.mean, 0)).toBeCloseTo(0, 9)
    expect(JSON.parse(JSON.stringify(report))).toEqual(report) // JSON-safe
  })

  it('leaves out hands cut off by the budget cap, using the replayed attempt instead', async () => {
    const store = new EventStore()
    const pricey = () => ids.map((id, i) => (i < 3 ? new MockLlm(id, 'mock/pricey', { inputPricePerMTok: 50 }) : new CallingStation(id)))
    await run(config({ budgetUsd: 2 }), pricey(), store)
    await run(config({ budgetUsd: 50 }), pricey(), store)
    const { hands, groups } = studyHands(store, config())
    expect(groups).toBe(8)
    expect(hands).toHaveLength(40)
    expect(new Set(hands.map((h) => h.handId.split('#')[0])).size).toBe(40) // one attempt per (group, rotation)
    expect(hands.some((h) => !h.handId.endsWith('#1'))).toBe(true) // a replayed attempt is used
    const { report } = analyseStudy(store, config({ budgetUsd: 50 }), { focusId: 'jev', generatedAt: at })
    expect(report.study.costUsd).toBeGreaterThan(report.metrics.reduce((s, m) => s + m.costUsd, 0)) // cut-off hands cost money too
  })

  it('picks the Jev seat as the focus and refuses a config that is not the study', async () => {
    expect(focusPlayer(parseStudyConfig({ ...rawWith([{ id: 'x', kind: 'bot', bot: 'tag' }, { id: 'j', kind: 'jev', model: 'jev-1' }]) }))).toBe('j')
    expect(focusPlayer(config())).toBe('jev')
    const store = new EventStore()
    await run(config(), mixed(), store)
    expect(() => analyseStudy(store, config({ masterSeed: 'other' }), { focusId: 'jev', generatedAt: at })).toThrow(/not for study config/)
    expect(() => analyseStudy(new EventStore(), config(), { focusId: 'jev', generatedAt: at })).toThrow(/has not started/)
  })
})

function rawWith(lineup: unknown[]) {
  return { id: 'f', lineup, masterSeed: 'm', budgetUsd: 1, targetHalfWidthBb100: 1, minGroups: 2, maxGroups: 2, checkEvery: 2 }
}

describe('decisionsCsv', () => {
  it('writes one quoted row per decision', async () => {
    const store = new EventStore()
    await run(config({ minGroups: 4, maxGroups: 4 }), mixed(), store)
    const { decisions } = analyseStudy(store, config({ minGroups: 4, maxGroups: 4 }), { focusId: 'jev', generatedAt: at })
    const csv = decisionsCsv(decisions)
    const lines = csv.trimEnd().split('\n')
    expect(lines).toHaveLength(decisions.length + 1)
    expect(lines[0]!.split(',').slice(0, 3)).toEqual(['handId', 'index', 'playerId'])
    expect(decisionsCsv([{ ...decisions[0]!, model: 'a "quoted", model' }])).toContain('"a ""quoted"", model"')
  })
})
