import { EventStore } from '@ab/core'
import type { ScoredDecision } from '@ab/analysis'
import { CallingStation, MockLlm, TagBot } from '@ab/players'
import { describe, expect, it } from 'vitest'
import { parseStudyConfig } from '../src/config'
import { headline, paperFacts, renderPaperHtml } from '../src/paper'
import { preregistration } from '../src/prereg'
import { analyseStudy, type StudyReport } from '../src/report'
import { runStudy } from '../src/run'

const ids = ['hex', 'pill', 'block', 'drip', 'nimbus']
const config = parseStudyConfig({
  id: 'p',
  lineup: ids.map((id) => ({ id, kind: 'mock' })),
  masterSeed: 'm',
  budgetUsd: 10,
  targetHalfWidthBb100: 0.001,
  minGroups: 4,
  maxGroups: 4,
  checkEvery: 4,
  bootstrapResamples: 1000,
})

async function analysis() {
  const store = new EventStore()
  const players = [new MockLlm('hex', 'mock/jev'), new TagBot('pill'), new CallingStation('block'), new MockLlm('drip', 'vendor/drip'), new CallingStation('nimbus')]
  await runStudy({ config, players, store, prereg: preregistration(config, config.lineup) })
  return analyseStudy(store, config, { focusId: 'hex', generatedAt: '2026-09-22T00:00:00.000Z' })
}

/** A decision with only the fields the paper reads set to something that matters. */
const decision = (over: Partial<ScoredDecision>): ScoredDecision =>
  ({
    handId: 'h',
    index: 0,
    playerId: 'hex',
    street: 'preflop',
    position: 'BTN',
    model: 'm',
    optionId: 'call',
    actionType: 'call',
    chipsIn: 0,
    pot: 0,
    winnablePot: 0,
    toCall: 0,
    stackBefore: 0,
    board: [],
    live: [],
    winProbability: 0.5,
    confidence: 0.5,
    optionProbabilities: null,
    latencyMs: 1,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    retries: 0,
    fallback: false,
    fallbackKind: null,
    mainPotShare: 0,
    stackChange: 0,
    expectedShare: 0.5,
    actionGood: 1,
    fallbackReason: null,
    reasoning: null,
    jevChoice: null,
    provider: null,
    rawReply: null,
    at: '',
    ...over,
  }) as ScoredDecision

/** Two players with hand-picked figures: the focus (Jev) and one model. */
function crafted(): { report: StudyReport; decisions: ScoredDecision[] } {
  const interval = (mean: number) => ({ mean, low: mean - 5, high: mean + 5, halfWidth: 5 })
  const metric = (playerId: string, p50: number, cost: number) =>
    ({ playerId, hands: 100, decisions: 4, costUsd: cost * 4, costPerDecisionUsd: cost, latencyP50Ms: p50, latencyP95Ms: p50 * 2, latencyMeanMs: p50, fallbacks: { model: 0, infra: 0, timeout: 0, auto: 0 }, fallbackRate: 0, modelFallbackRate: 0, retryRate: 0, style: { vpip: 0.2, pfr: 0.1, af: 1, wtsd: 0.3 } }) as unknown as StudyReport['metrics'][number]
  const cal = { n: 4, brier: 0.1, ece: 0.05, bins: [] }
  const report = {
    kind: 'artificialBluff study report',
    version: 1,
    generatedAt: '2026-09-22T00:00:00.000Z',
    study: { id: 's', configHash: 'abc', status: 'ended', endReason: 'budget_cap', analysedGroups: 20, blocks: 5, hands: 100, decisions: 8, costUsd: 1, preregistration: {} },
    players: [
      { playerId: 'hex', kind: 'jev', model: 'jev-1.13.0', answeredModels: ['jev-1.13.0'] },
      { playerId: 'pill', kind: 'llm', model: 'anthropic/claude-fable-5.1', answeredModels: ['anthropic/claude-fable-5.1'] },
    ],
    focusId: 'hex',
    results: [
      { playerId: 'hex', bb100: interval(12), bb100Bootstrap: interval(12), hands: 100 },
      { playerId: 'pill', bb100: interval(-12), bb100Bootstrap: interval(-12), hands: 100 },
    ],
    contrasts: [{ focusId: 'hex', otherId: 'pill', diff: interval(24), pValue: 0.2, pHolm: 0.2, significant: false }],
    metrics: [metric('hex', 200, 0.00005), metric('pill', 4000, 0.01)],
    calibration: ['hex', 'pill'].map((playerId) => ({ playerId, confidenceSource: '', winA: cal, winC: cal, actionByType: { fold: cal, check: cal, call: cal, raise: cal } })),
    notes: [],
  } as unknown as StudyReport
  const decisions = [
    // Jev: 5 points off the truth either way, so 5 off on average and no lean.
    decision({ playerId: 'hex', winProbability: 0.55, expectedShare: 0.5, actionType: 'fold', actionGood: 1, optionId: 'fold', jevChoice: 'fold' }),
    decision({ playerId: 'hex', winProbability: 0.45, expectedShare: 0.5, actionType: 'fold', actionGood: 1, optionId: 'fold', jevChoice: 'fold' }),
    // Jev's own pick was a call; the pre-registered rule played a raise.
    decision({ playerId: 'hex', winProbability: 0.5, expectedShare: 0.5, actionType: 'raise', optionId: 'min_raise', jevChoice: 'call', fallback: true, fallbackKind: 'infra' }),
    decision({ playerId: 'hex', winProbability: null, expectedShare: 0.5, actionType: 'raise', optionId: 'open_3bb', jevChoice: 'call' }),
    // The model: 30 points high every time, and one of two folds wrong.
    decision({ playerId: 'pill', winProbability: 0.8, expectedShare: 0.5, actionType: 'fold', actionGood: 1, provider: 'Anthropic' }),
    decision({ playerId: 'pill', winProbability: 0.8, expectedShare: 0.5, actionType: 'fold', actionGood: 0, provider: 'Google' }),
    // A fallback says nothing about the model's judgement, so it is left out.
    decision({ playerId: 'pill', winProbability: 0.0, expectedShare: 0.9, actionType: 'fold', actionGood: 0, fallback: true, fallbackKind: 'timeout', provider: 'Anthropic' }),
  ]
  return { report, decisions }
}

describe('paper facts', () => {
  it('measures each model the same way, and compares the focus with the rest', () => {
    const { report, decisions } = crafted()
    const f = paperFacts(report, decisions)
    expect(f.focus).toMatchObject({ playerId: 'hex', foldRight: { n: 2, rate: 1 } })
    expect(f.focus.offTruthPts).toBeCloseTo(5, 9)
    expect(f.focus.biasPts).toBeCloseTo(0, 9)
    expect(f.others[0]).toMatchObject({ playerId: 'pill', foldRight: { n: 2, rate: 0.5 } })
    expect(f.others[0]!.offTruthPts).toBeCloseTo(30, 9)
    expect(f.others[0]!.biasPts).toBeCloseTo(30, 9)
    expect(f.speed.timesFasterThanFastest).toBeCloseTo(20, 9) // 4,000 ms against 200
    expect(f.cost.timesCheaperThanCheapest).toBeCloseTo(200, 9) // $0.01 against $0.00005
    expect(f.truth).toMatchObject({ focusBest: true })
    // A chip difference that is not significant is never claimed.
    expect(f.significantChipWins).toEqual([])
  })

  it('counts how often the move rule overrode Jev\'s own pick, and which hosts served each model', () => {
    const { report, decisions } = crafted()
    const f = paperFacts(report, decisions)
    // Three moves Jev made itself (the fallback isn't its move); one was changed, from a call to a raise.
    expect(f.moveRule).toEqual({ moves: 3, changed: 1, toRaise: 1, toCall: 0, toFold: 0 })
    // Hosts over every call made, failed ones too: they are where the time was spent.
    expect(f.others[0]!.hosts).toEqual([{ name: 'Anthropic', share: 2 / 3 }, { name: 'Google', share: 1 / 3 }])
    expect(f.focus.hosts).toEqual([])
    // A study logged before Jev's pick was recorded says nothing about the rule.
    expect(paperFacts(report, decisions.map((d) => ({ ...d, jevChoice: null }))).moveRule).toBeNull()
  })

  it('writes a headline from what held, and nothing that did not', () => {
    const { report, decisions } = crafted()
    const f = paperFacts(report, decisions)
    expect(headline(f)).toBe('20× faster, 200× cheaper, and closer to the true odds than every model it played.')
    // If the focus were slower, the headline must not say faster.
    const slow = { ...f, speed: { ...f.speed, timesFasterThanFastest: 0.5 } }
    expect(headline(slow)).not.toContain('faster')
  })
})

describe('renderPaperHtml', () => {
  it('reports the move rule\'s effect and the hosts when the log has them', () => {
    const { report, decisions } = crafted()
    const html = renderPaperHtml(report, decisions, { mock: false })
    expect(html).toContain('changed 1 of Jev’s 3 moves (33%)')
    expect(html).toContain('<th>Served by</th>')
    expect(html).toContain('Anthropic 67%, Google 33%')
  })

  it('lays out a paper: title, abstract, every section, the figures and tables, and no broken numbers', async () => {
    const { report, decisions } = await analysis()
    const html = renderPaperHtml(report, decisions, { mock: true })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    for (const s of ['Abstract', '1 Introduction', '2 Background', '3 Method', '4 Results', '5 Discussion', '6 Limitations', '7 Conclusion', 'References']) expect(html).toContain(s)
    expect(html.match(/<figure/g)!.length).toBeGreaterThanOrEqual(4)
    expect(html.match(/<table/g)!.length).toBeGreaterThanOrEqual(3)
    expect(html).toContain(report.study.configHash.slice(0, 12)) // the pre-registration it answers to
    expect(html).toContain('REHEARSAL') // a mock study says so on every page
    expect(html).toContain('most total weight') // how Jev's answer becomes a move, stated and in the record
    expect(html).not.toMatch(/NaN|undefined|Infinity/)
  })

  it('escapes whatever came from the log or the config', async () => {
    const { report, decisions } = await analysis()
    const hostile = { ...report, players: report.players.map((p, i) => (i === 1 ? { ...p, model: '<script>x</script>' } : p)) }
    expect(renderPaperHtml(hostile, decisions, { mock: true })).not.toContain('<script>x')
  })
})
