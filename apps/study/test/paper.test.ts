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
  const cal = (brier: number, ece: number) => ({ n: 4, brier, ece, bins: [] })
  // Against the pot actually won (A, the pre-registered headline) the model does better; against the
  // true chance (C) Jev is the better calibrated.
  const calOf: Record<string, { winA: ReturnType<typeof cal>; winC: ReturnType<typeof cal> }> = {
    hex: { winA: cal(0.25, 0.17), winC: cal(0.056, 0.011) },
    pill: { winA: cal(0.13, 0.136), winC: cal(0.047, 0.039) },
  }
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
    calibration: ['hex', 'pill'].map((playerId) => ({ playerId, confidenceSource: '', ...calOf[playerId]!, actionByType: { fold: cal(0.1, 0.05), check: cal(0.1, 0.05), call: cal(0.1, 0.05), raise: cal(0.1, 0.05) } })),
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

/**
 * The follow-up study's shape: a two-step Jev (the focus), a one-question Jev played as returned, and a
 * language model, with hand facts on. Built from crafted() by adding the second Jev and the
 * pre-registration it reads.
 */
function withSibling(): { report: StudyReport; decisions: ScoredDecision[] } {
  const { report, decisions } = crafted()
  const hex = report.metrics.find((m) => m.playerId === 'hex')!
  const cal = report.calibration.find((c) => c.playerId === 'hex')!
  const r = {
    ...report,
    study: {
      ...report.study,
      preregistration: {
        study: {
          handFacts: true,
          lineup: [
            { id: 'hex', kind: 'jev', model: 'jev-1.13.0', mode: 'two-step' },
            { id: 'pill', kind: 'llm', model: 'anthropic/claude-fable-5.1' },
            { id: 'sib', kind: 'jev', model: 'jev-1.13.0', mode: 'raw' },
          ],
        },
        jevModes: { raw: "TypeSafe's choice is played as returned, and code changes nothing", 'two-step': 'the kind Jev chose, at the amount it chose; code changes nothing' },
        prompts: { jevAction: 'Which action maximises your expected chips?', jevKind: 'Which kind of action maximises your expected chips?', jevSize: 'If you bet or raise, which amount maximises your expected chips?' },
      },
    },
    players: [...report.players, { playerId: 'sib', kind: 'jev', model: 'jev-1.13.0', answeredModels: ['jev-1.13.0'] }],
    // The one-question Jev: as fast and cheap as the focus, worse against the pot actually won.
    metrics: [...report.metrics, { ...hex, playerId: 'sib', latencyP50Ms: 190 }],
    calibration: [...report.calibration, { ...cal, playerId: 'sib', winA: { ...cal.winA, brier: 0.3 }, winC: { ...cal.winC, ece: 0.02 } }],
    results: [...report.results, { playerId: 'sib', bb100: { mean: -20, low: -60, high: 20, halfWidth: 40 }, bb100Bootstrap: { mean: -20, low: -60, high: 20, halfWidth: 40 }, hands: 100 }],
    contrasts: [...report.contrasts, { focusId: 'hex', otherId: 'sib', diff: { mean: 32, low: -8, high: 72, halfWidth: 40 }, pValue: 0.1, pHolm: 0.2, significant: false }],
  } as unknown as StudyReport
  return { report: r, decisions: [...decisions, decision({ playerId: 'sib', winProbability: 0.5, expectedShare: 0.4, optionId: 'call', actionType: 'call', jevChoice: 'call' })] }
}

describe('a study of two Jevs', () => {
  it('names each Jev by how it was asked, and compares speed and cost with the language models only', () => {
    const { report, decisions } = withSibling()
    const f = paperFacts(report, decisions)
    expect(f.focus.label).toBe('Jev (two-step, jev-1.13.0)')
    expect(f.sibling?.label).toBe('Jev (one question, jev-1.13.0)')
    // The one-question Jev is faster than the focus here, but it isn't a general-purpose model.
    expect(f.speed.fastestOther?.playerId).toBe('pill')
    expect(f.cost.cheapestOther?.playerId).toBe('pill')
  })

  it('frames the paper as one question against two, and describes both ways of asking and the hand facts', () => {
    const { report, decisions } = withSibling()
    const html = renderPaperHtml(report, decisions, { mock: false })
    expect(html).toContain('One Question or Two')
    const abstract = html.slice(html.indexOf('<section class="abstract">'), html.indexOf('</section>'))
    expect(abstract).toContain('two ways of asking Jev')
    expect(abstract).not.toMatch(/language models? \(Jev/)
    // Both ways of asking, and that code decides nothing in either.
    expect(html).toContain('what kind of action')
    expect(html).toContain('code changes nothing')
    expect(html).toContain('The move played is its single most likely option.')
    expect(html).toContain('hand facts')
    expect(html).toContain('One question or two</h3>')
    // Head to head: the pre-registered chip contrast and both calibration measures.
    expect(html).toContain('Jev (two-step) minus Jev (one question): +32.0 bb/100')
    expect(html).toContain('Jev (two-step): which amount') // the second question, printed in the appendix
    expect(html).not.toMatch(/NaN|undefined|Infinity|decomposed|composed in code/)
    const conclusion = html.slice(html.indexOf('7 Conclusion'), html.indexOf('References'))
    expect(conclusion).toMatch(/<p>Jev \(two-step\) was/)
  })

  it('never prints a range whose two ends read the same', async () => {
    const { report, decisions } = await analysis()
    expect(renderPaperHtml(report, decisions, { mock: true })).not.toMatch(/(\b[\d.]+%?)–\1(?![\d.])/)
  })

  it('calls a tie a tie, names a model once when it is best on both measures, and discusses a chip result with its table', () => {
    const { report, decisions } = withSibling()
    const tied = {
      ...report,
      calibration: report.calibration.map((c) => (c.playerId === 'sib' ? { ...c, winA: { ...c.winA, brier: 0.2502 } } : c.playerId === 'pill' ? { ...c, winA: { ...c.winA, brier: 0.1 }, winC: { ...c.winC, ece: 0.005 } } : c)),
      // The focus beat the language model, which lost heavily, significantly.
      results: report.results.map((r) => (r.playerId === 'pill' ? { ...r, bb100: { mean: -300, low: -420, high: -180, halfWidth: 120 } } : r)),
      contrasts: report.contrasts.map((c) => (c.otherId === 'pill' ? { ...c, diff: { mean: 312, low: 150, high: 474, halfWidth: 162 }, pHolm: 0.001, significant: true } : c)),
    } as unknown as StudyReport
    const html = renderPaperHtml(tied, decisions, { mock: false })
    expect(html).toContain('Brier against the pot actually won 0.250 against 0.250 (level)')
    expect(html).toContain('claude-fable-5.1 scored best on both')
    const discussion = html.slice(html.indexOf('5 Discussion'), html.indexOf('6 Limitations'))
    expect(discussion).toContain('won significantly more chips than claude-fable-5.1')
    expect(discussion).toContain('claude-fable-5.1 lost 300.0 bb/100')
  })

  it('reads a one-Jev study as before', () => {
    const { report, decisions } = crafted()
    const f = paperFacts(report, decisions)
    expect(f.sibling).toBeNull()
    expect(f.focus.label).toBe('Jev (jev-1.13.0)')
    expect(renderPaperHtml(report, decisions, { mock: false })).not.toContain('One Question or Two')
  })
})

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

  it('ranks every model on the pre-registered headline outcome as well as on the true chance', () => {
    const f = paperFacts(...Object.values(crafted()) as [StudyReport, ScoredDecision[]])
    expect(f.focus).toMatchObject({ brierA: 0.25, eceA: 0.17, eceC: 0.011 })
    // Against what actually happened the model beat Jev; against the true chance Jev is the better calibrated.
    expect(f.outcome).toMatchObject({ focusRank: 2, of: 2 })
    expect(f.outcome.best?.playerId).toBe('pill')
    expect(f.calibration).toMatchObject({ focusBestEce: true })
    // How far the stated chances moved: Jev said 55 and 45 (5 points either side), the model 80 twice.
    expect(f.focus.spreadPts).toBeCloseTo(5, 9)
    expect(f.others[0]!.spreadPts).toBeCloseTo(0, 9)
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

describe('the paper as a research paper', () => {
  it('states its question, its contributions, its statistics, and where the data are', async () => {
    const { report, decisions } = await analysis()
    const html = renderPaperHtml(report, decisions, { mock: true })
    expect(html).toContain('<p class="question">')
    expect(html).toMatch(/<ol class="contrib">(\s*<li>.*?<\/li>){3}/s)
    expect(html).toContain('3.5 Statistical analysis')
    expect(html).toContain('milli-big-blinds per game')
    expect(html).toContain('Data availability')
    for (const ref of ['AIVAT', 'PokerBench', 'Poker Arena', 'Game Arena', 'Adding error bars', 'preregistration revolution', 'vector partition']) expect(html).toContain(ref)
    // Every citation points at a reference that exists.
    const refs = html.slice(html.indexOf('<ol class="refs">'), html.indexOf('</ol>', html.indexOf('<ol class="refs">'))).match(/<li>/g)!.length
    const cited = [...html.matchAll(/\[(\d+(?:[,–] ?\d+)*)\]/g)].flatMap((m) => m[1]!.split(/[,–] ?/).map(Number))
    expect(Math.max(...cited)).toBeLessThanOrEqual(refs)
  })

  it('reports decisions and estimates on identical spots, as exploratory unless pre-registered as primary', async () => {
    const { report, decisions } = await analysis()
    const html = renderPaperHtml(report, decisions, { mock: true })
    expect(html).toContain('4.2 Identical spots (exploratory)')
    const primary = { ...report, study: { ...report.study, preregistration: { ...(report.study.preregistration as object), primaryOutcomes: 'matched spots', study: { primary: 'matched-spots' } } } } as StudyReport
    expect(renderPaperHtml(primary, decisions, { mock: true })).toContain('4.2 Identical spots (pre-registered primary outcome)')
  })

  it('titles, describes and states a primary, fixed-size, two-step study as what it is', async () => {
    const { report, decisions } = await analysis()
    const pre = report.study.preregistration as { study: Record<string, unknown> }
    const final = {
      ...report,
      study: {
        ...report.study,
        preregistration: {
          ...pre,
          study: { ...pre.study, primary: 'matched-spots', minGroups: 4, maxGroups: 4, lineup: [{ id: 'hex', kind: 'jev', model: 'jev-1.13.0', mode: 'two-step' }] },
          primaryOutcomes: 'on matched spots, the first jev seat minus each other seat',
          secondaryOutcomes: 'chips and the rest',
          jevModes: { 'two-step': 'two Choices asked together; code changes nothing' },
        },
      },
      players: report.players.map((p) => (p.playerId === 'hex' ? { ...p, kind: 'jev', model: 'jev-1.13.0' } : p)),
    } as StudyReport
    const html = renderPaperHtml(final, decisions, { mock: true })
    expect(html).toContain('Knowing the Odds and Acting on Them')
    // The one Jev at the table is asked in two steps, and the paper says so.
    expect(html).toContain('asked each decision in two parts')
    expect(html).not.toContain('The move played is its single most likely option.')
    expect(html).toContain('fixed in advance at 4 groups')
    expect(html).toContain('<b>Primary outcomes.</b>')
    // The identical-spots table spans the page, so its intervals aren't cut off.
    expect(html).toMatch(/<div class="wide">\s*<p class="tablecap"><b>Table 3\./)
  })

  it('tells how the protocol was developed from the pilot studies', async () => {
    const { report, decisions } = await analysis()
    const html = renderPaperHtml(report, decisions, { mock: true, pilots: [{ id: 'pilot-a', lesson: 'Our raising rule changed a third of Jev’s moves.', report }] })
    expect(html).toContain('3.6 Protocol development')
    expect(html).toContain('pilot-a')
    expect(html).toContain('Our raising rule changed a third of Jev’s moves.')
  })

  it('numbers tables and figures in order and points at the right ones', async () => {
    const { report, decisions } = await analysis()
    const html = renderPaperHtml(report, decisions, { mock: true })
    expect([...html.matchAll(/<b>Table (\d)\.<\/b>/g)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect([...html.matchAll(/<b>Figure (\d)\.<\/b>/g)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6])
    expect(html).toContain('Table 6 gives')
    expect(html).toMatch(/paired comparisons in Table 7/)
  })
})

describe('renderPaperHtml', () => {
  it('reports the move rule\'s effect and the hosts when the log has them', () => {
    const { report, decisions } = crafted()
    const html = renderPaperHtml(report, decisions, { mock: false })
    expect(html).toContain('changed 1 of Jev’s 3 moves (33%)')
    // Hosts sit on a line of their own under each model, so a long list can't squeeze the table.
    expect(html).toContain('served by Anthropic 67%, Google 33%')
    expect(html).not.toContain('<th>Served by</th>')
  })

  it('names every model level with the best on the headline outcome, as printed', () => {
    const { report, decisions } = crafted()
    const tied = { ...report, calibration: report.calibration.map((c) => ({ ...c, winA: { ...c.winA, brier: c.playerId === 'hex' ? 0.1304 : 0.1298 } })) }
    const html = renderPaperHtml(tied, decisions, { mock: false })
    expect(html).toContain('Jev and claude-fable-5.1 scored best (Brier 0.130)')
  })

  it('states the pre-registered headline outcome, and says so when the focus did worse on it', () => {
    const { report, decisions } = crafted()
    const html = renderPaperHtml(report, decisions, { mock: false })
    expect(html).toContain('share of the main pot each model actually won')
    expect(html).toContain('claude-fable-5.1 scored best (Brier 0.130); Jev ranked 2nd of 2 (Brier 0.250)')
    expect(html).toContain('best calibrated on average (ECE 0.011')
    // The abstract carries both, and the conclusion doesn't claim what didn't hold.
    const abstract = html.slice(html.indexOf('<section class="abstract">'), html.indexOf('</section>'))
    expect(abstract).toContain('Brier 0.250')
    const conclusion = html.slice(html.indexOf('7 Conclusion'), html.indexOf('References'))
    expect(conclusion).not.toContain('knows what it knows')
    expect(conclusion).toContain('ranked 2nd of 2')
    // Tables are numbered in order and the text points at the right ones.
    const caps = [...html.matchAll(/<b>Table (\d)\.<\/b>/g)].map((m) => Number(m[1]))
    // Crafted reports carry no identical-spot statistics, so that table is left out.
    expect(caps).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(html).toContain('Table 5 gives')
    expect(html).toMatch(/claims about Jev rest on the paired comparisons in Table 6/)
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
