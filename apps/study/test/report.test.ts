import { EventStore } from '@ab/core'
import { CallingStation, MockLlm, TagBot, type Player } from '@ab/players'
import { describe, expect, it } from 'vitest'
import { parseStudyConfig, type StudyConfig } from '../src/config'
import { decisionsCsv, handsCsv } from '../src/exports'
import { preregistration } from '../src/prereg'
import { analyseStudy, analysedGroupCount, focusPlayer, studyHands } from '../src/report'
import { emptyProgress, handKeyOf } from '../src/progress'
import { runStudy } from '../src/run'

const ids = ['hex', 'pill', 'block', 'drip', 'nimbus']

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

const mixed = (): Player[] => [new MockLlm('hex', 'mock/jev'), new TagBot('pill'), new CallingStation('block'), new MockLlm('drip', 'mock/drip'), new CallingStation('nimbus')]
const run = (c: StudyConfig, players: Player[], store: EventStore) => runStudy({ config: c, players, store, prereg: preregistration(c, c.lineup) })
const at = '2026-09-22T00:00:00.000Z'

describe('study report', () => {
  it('analyses exactly the hands behind the published results', async () => {
    const store = new EventStore()
    const c = config()
    const outcome = await run(c, mixed(), store)
    const { report, decisions } = analyseStudy(store, c, { focusId: 'hex', generatedAt: at })
    expect(report.study).toMatchObject({ id: 'r', analysedGroups: 8, blocks: 2, hands: 40, endReason: outcome.reason, status: 'ended', configHash: outcome.configHash })
    expect(report.results).toEqual(outcome.summary.players)
    expect(report.contrasts.map((x) => x.otherId)).toEqual(['pill', 'block', 'drip', 'nimbus'])
    expect(report.players[0]).toMatchObject({ playerId: 'hex', kind: 'mock', model: 'mock/jev', answeredModels: ['mock/jev'] })
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
    // The comparison family and the per-action rules are part of the pre-registration.
    expect(report.study.preregistration).toMatchObject({ contrasts: expect.stringContaining('Holm'), outcomes: { perAction: expect.stringContaining('winnable pot') } })
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
    const { report } = analyseStudy(store, config({ budgetUsd: 50 }), { focusId: 'hex', generatedAt: at })
    expect(report.study.costUsd).toBeGreaterThan(report.metrics.reduce((s, m) => s + m.costUsd, 0)) // cut-off hands cost money too
  })

  it('uses the logged stopping boundary until the study ends, and analysedGroups after', () => {
    const c = config({ minGroups: 40, maxGroups: 80 })
    const p = emptyProgress()
    for (let g = 0; g < 12; g++) for (let r = 0; r < 5; r++) p.valid.set(handKeyOf(g, r), {})
    expect(analysedGroupCount(p, 'running', c)).toBe(12) // no stop logged: the completed prefix
    p.lastCheckpoint = { groups: 8, stop: true } // rule met at 8, hands still finishing (or a crash)
    expect(analysedGroupCount(p, 'running', c)).toBe(8)
    p.analysedGroups = 8
    expect(analysedGroupCount(p, 'ended', c)).toBe(8)
    p.lastCheckpoint = { groups: 4, stop: false }
    p.analysedGroups = null
    expect(analysedGroupCount(p, 'interrupted', c)).toBe(12)
  })

  it('picks the Jev seat as the focus and refuses a config that is not the study', async () => {
    expect(focusPlayer(parseStudyConfig({ ...rawWith([{ id: 'x', kind: 'bot', bot: 'tag' }, { id: 'j', kind: 'jev', model: 'jev-1' }]) }))).toBe('j')
    expect(focusPlayer(config())).toBe('hex')
    const store = new EventStore()
    await run(config(), mixed(), store)
    expect(() => analyseStudy(store, config({ masterSeed: 'other' }), { focusId: 'hex', generatedAt: at })).toThrow(/not for study config/)
    expect(() => analyseStudy(new EventStore(), config(), { focusId: 'hex', generatedAt: at })).toThrow(/has not started/)
  })
})

function rawWith(lineup: unknown[]) {
  return { id: 'f', lineup, masterSeed: 'm', budgetUsd: 1, targetHalfWidthBb100: 1, minGroups: 2, maxGroups: 2, checkEvery: 2 }
}

describe('decisionsCsv', () => {
  it('writes one quoted row per decision', async () => {
    const store = new EventStore()
    await run(config({ minGroups: 4, maxGroups: 4 }), mixed(), store)
    const { decisions } = analyseStudy(store, config({ minGroups: 4, maxGroups: 4 }), { focusId: 'hex', generatedAt: at })
    const csv = decisionsCsv(decisions)
    const lines = csv.trimEnd().split('\n')
    expect(lines).toHaveLength(decisions.length + 1)
    expect(lines[0]!.split(',').slice(0, 3)).toEqual(['handId', 'index', 'playerId'])
    expect(decisionsCsv([{ ...decisions[0]!, model: 'a "quoted", model' }])).toContain('"a ""quoted"", model"')
    expect(lines[0]).toContain(',pot,winnablePot,toCall,')
    expect(lines[0]).toContain(',fallbackKind,fallbackReason,jevChoice,provider,reasoning,rawReply,at,')
    // Text that a spreadsheet would evaluate is defused; negative numbers are not.
    const row = decisionsCsv([{ ...decisions[0]!, model: '=HYPERLINK("x")', stackChange: -150 }]).split('\n')[1]!
    expect(row).toContain(`"'=HYPERLINK(""x"")"`)
    expect(row.endsWith(',-150')).toBe(true)
  })
})

describe('handsCsv', () => {
  it('writes one row per hand and player, placed in the duplicate schedule, so bb/100 can be recomputed', async () => {
    const c = config({ minGroups: 4, maxGroups: 4 })
    const store = new EventStore()
    await run(c, mixed(), store)
    const { hands } = analyseStudy(store, c, { focusId: 'hex', generatedAt: at })
    const lines = handsCsv(hands, store.events(c.id)).trimEnd().split('\n')
    expect(lines[0]).toBe('handId,group,rotation,order,seed,attempt,playerId,position,hole,board,startStack,net,netBb,sawFlop,showdown,wonMainPot')
    expect(lines).toHaveLength(hands.length * ids.length + 1)
    const rows = lines.slice(1).map((l) => l.split(','))
    // Every hand of 4 groups x 5 rotations, and chips only change hands: each hand nets to zero.
    expect(new Set(rows.map((r) => `${r[1]}/${r[2]}`)).size).toBe(20)
    const byHand = new Map<string, number>()
    for (const r of rows) byHand.set(r[0]!, (byHand.get(r[0]!) ?? 0) + Number(r[11]))
    expect([...byHand.values()].every((n) => n === 0)).toBe(true)
    const first = rows[0]!
    expect(Number(first[12])).toBe(Number(first[11]) / 100)
    expect(first[8]).toMatch(/^[2-9TJQKA][cdhs] [2-9TJQKA][cdhs]$/)
  })
})
