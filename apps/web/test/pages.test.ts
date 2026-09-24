import type { HandSummary } from '@ab/server'
import { describe, expect, it } from 'vitest'
import { leadTag } from '../components/HandCard'
import { filterHands, FILTERS } from '../lib/replays'
import type { ModelFacts, PaperFacts } from '@ab/study/paper'
import { researchCaveat, researchTiles } from '../lib/research'


const hand = (over: Partial<HandSummary>): HandSummary => ({
  gameId: 'g',
  handId: 'h',
  number: 1,
  ts: 0,
  pot: 100,
  won: { jev: 100 },
  bigBlind: 50,
  players: ['hex', 'pill'],
  winners: ['jev'],
  shown: [],
  busted: [],
  decisions: 8,
  seconds: 45,
  reads: [],
  tags: [],
  headline: 'HEX wins 100 after everyone else folded',
  startSeq: 1,
  ...over,
})

describe('research figures', () => {
  // A measured study, reduced to the facts the page reads (the paper computes the same ones).
  const model = (over: Partial<ModelFacts>): ModelFacts => ({
    playerId: 'x',
    model: 'a/x',
    kind: 'llm',
    mode: null,
    label: 'x',
    focus: false,
    answered: 100,
    latencyP50Ms: 4000,
    latencyP95Ms: 9000,
    costPerDecisionUsd: 0.01,
    fallbackRate: 0.02,
    offTruthPts: 20,
    biasPts: 12,
    brierC: 0.1,
    eceC: 0.05,
    calibrationC: null,
    foldRight: { n: 40, rate: 0.6 },
    callRight: { n: 20, rate: 0.5 },
    bb100: { mean: -5, low: -40, high: 30 },
    vsFocus: { mean: 10, low: -20, high: 40, pHolm: 0.4, significant: false },
    hosts: [],
    brierA: 0.1,
    eceA: 0.1,
    spreadPts: 15,
    truthSpreadPts: 25,
    ...over,
  })
  const jev = model({ playerId: 'hex', model: 'jev-1.13.0', kind: 'jev', mode: 'choice', label: 'Jev (jev-1.13.0)', focus: true, latencyP50Ms: 200, costPerDecisionUsd: 0.00005, fallbackRate: 0, offTruthPts: 6, biasPts: -1, foldRight: { n: 30, rate: 0.9 }, callRight: { n: 10, rate: 0.8 }, bb100: { mean: 5, low: -25, high: 35 }, vsFocus: null, brierA: 0.2, eceC: 0.02 })
  const fable = model({ playerId: 'pill', label: 'claude-fable-5.1', latencyP50Ms: 3000, costPerDecisionUsd: 0.012, offTruthPts: 18, biasPts: 15, brierA: 0.12, eceC: 0.04 })
  const llama = model({ playerId: 'nimbus', label: 'llama-4-maverick', latencyP50Ms: 5000, costPerDecisionUsd: 0.0002, offTruthPts: 25, biasPts: -8, fallbackRate: 0.05, brierA: 0.15, eceC: 0.08 })
  const facts = (over: Partial<PaperFacts> = {}): PaperFacts => ({
    study: { id: 'main', configHash: 'abcdef0123456789', status: 'ended', endReason: 'budget_cap', analysedGroups: 160, blocks: 40, hands: 800, decisions: 4800, costUsd: 25, preregistration: {} },
    generatedAt: '2026-09-30T00:00:00.000Z',
    focus: jev,
    others: [fable, llama],
    decisions: 4800,
    speed: { fastestOther: fable, slowestOther: llama, timesFasterThanFastest: 15, timesFasterThanSlowest: 25 },
    cost: { cheapestOther: llama, dearestOther: fable, timesCheaperThanCheapest: 4, timesCheaperThanDearest: 240 },
    truth: { focusBest: true, bestOther: fable, worstOther: llama },
    significantChipWins: [],
    significantChipLosses: [],
    moveRule: null,
    sibling: null,
    outcome: { best: fable, focusRank: 3, of: 3 },
    calibration: { focusBestEce: true, bestOtherEce: fable },
    ...over,
  })

  it('turns the measured facts into tiles, each set against the other models', () => {
    const tiles = researchTiles(facts())
    expect(tiles.map((t) => t.value)).toEqual(['15×', '4.0×', '3rd of 3', '0.020', '6.0 pts', '88%', '±30 bb', '4,800'])
    expect(tiles[0]!.what).toBe('faster to a decision: 200 ms median against 3.00 s for claude-fable-5.1, the fastest of the others')
    // The pre-registered headline is on the page, whichever way it went.
    expect(tiles[2]!.what).toBe('by Brier score against the pot actually won, the pre-registered headline: Jev 0.200; 0.120–0.150 for the others')
    expect(tiles[3]!.what).toBe('calibration error against the true odds (ECE, lower is better), the lowest of any model; 0.040–0.080 for the others')
    expect(tiles[4]!.what).toContain('18.0–25.0 pts for the others')
    expect(tiles[5]!.what).toContain('57%') // the others' folds and calls, pooled the same way
    // No chip difference was significant, so the tile gives the interval and says so.
    expect(tiles[6]!.what).toContain('no chip difference is significant yet')
  })

  it('claims a chip result only when the pre-registered test says so', () => {
    const won = researchTiles(facts({ significantChipWins: [{ ...llama, vsFocus: { mean: 42, low: 10, high: 74, pHolm: 0.01, significant: true } }] }))
    expect(won[6]).toEqual({ value: '+42 bb', what: 'per 100 hands over llama-4-maverick, significant after Holm’s correction' })
  })

  it('states what a ratio could not claim as a plain figure instead', () => {
    const slow = researchTiles(facts({ speed: { ...facts().speed, timesFasterThanFastest: 1.1 } }))
    expect(slow[0]!.value).toBe('200 ms')
    expect(slow[0]!.what).not.toContain('faster')
  })

  it('says how much the figures rest on, and what is and is not significant', () => {
    const c = researchCaveat(facts())
    expect(c).toContain('800 hands')
    expect(c).toContain('40 blocks')
    expect(c).toContain('abcdef012345')
    expect(c).toContain('no chip difference is significant')
  })
})

describe('replays list', () => {
  it('filters by tag and leads each hand with its most notable one', () => {
    const hands = [hand({ number: 3, tags: ['showdown', 'biggest-pot'] }), hand({ number: 2, tags: ['elimination', 'showdown'] }), hand({ number: 1 })]
    expect(filterHands(hands, 'all')).toHaveLength(3)
    expect(filterHands(hands, 'showdown').map((h) => h.number)).toEqual([3, 2])
    expect(filterHands(hands, 'timeout')).toEqual([])
    expect(leadTag(hands[0]!)).toBe('biggest-pot')
    expect(leadTag(hands[1]!)).toBe('elimination') // a knock-out beats a showdown
    expect(leadTag(hands[2]!)).toBeNull()
    expect(FILTERS[0]!.id).toBe('all')
  })
})
