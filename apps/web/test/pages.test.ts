import type { ModelsTable, HandSummary, SeatSummary } from '@ab/server'
import { describe, expect, it } from 'vitest'
import { leadTag } from '../components/HandCard'
import { filterHands, FILTERS } from '../lib/replays'
import { researchHeadline, researchMetrics } from '../lib/research'

const seat = (over: Partial<SeatSummary>): SeatSummary => ({
  playerId: 'x',
  kind: 'llm',
  model: 'a/b',
  games: 1,
  hands: 40,
  handsWon: 10,
  winRate: 0.25,
  chipsWon: 0,
  bb100: 0,
  decisions: 50,
  latencyMeanMs: 1000,
  costUsd: 1,
  costPerDecisionUsd: 0.02,
  biasPts: 10,
  errorPts: 12,
  statedDecisions: 50,
  models: ['a/b'],
  fallbacks: 0,
  style: { vpip: 0.2, pfr: 0.1, af: 1, wtsd: 0.3 },
  ...over,
})

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
  const table: ModelsTable = {
    games: 2,
    hands: 80,
    seats: [
      seat({ playerId: 'hex', kind: 'jev', biasPts: -1, errorPts: 2, costPerDecisionUsd: 0.0009, latencyMeanMs: 240, decisions: 100, fallbacks: 0 }),
      seat({ playerId: 'pill', biasPts: 28, errorPts: 31, costPerDecisionUsd: 0.214, latencyMeanMs: 1620, decisions: 100, fallbacks: 3 }),
    ],
    models: [],
  }

  it('says only what the numbers say', () => {
    expect(researchHeadline(table)).toBe('The cheapest seat is also the one whose stated chances sit closest to the truth: HEX.')
    // PILL states the closest chances, HEX is the cheapest: then the headline names both.
    const split = { ...table, seats: [table.seats[0]!, seat({ playerId: 'pill', biasPts: 1, errorPts: 1, costPerDecisionUsd: 0.05 })] }
    expect(researchHeadline(split)).toBe('PILL states the chances closest to the truth; HEX costs the least per decision.')
    expect(researchHeadline({ games: 0, hands: 0, seats: [], models: [] })).toBe('Not enough hands yet to say anything.')
  })

  it('turns the table into figures, and drops ratios that are not really differences', () => {
    const m = researchMetrics(table)
    expect(m[0]).toEqual({ value: '2 pts', what: "HEX's stated win chance sits this far from the true one, on average" })
    expect(m[1]!.value).toBe('31 pts')
    expect(m[2]).toEqual({ value: '+28 pts', what: 'PILL talks itself up by this much on average, over and under cancelled' })
    expect(m[3]!.value).toBe('238×') // $0.214 against $0.0009
    expect(m[4]!.value).toBe('6.8×') // 1.62 s against 240 ms
    expect(m.some((x) => x.what.includes('decisions logged across 80 hands'))).toBe(true)
    expect(researchMetrics({ games: 1, hands: 1, seats: [table.seats[0]!], models: [] }).some((x) => x.what.includes('across 1 hand,'))).toBe(true) // not "1 hands"
    expect(m.some((x) => x.value === '3 of 200')).toBe(true) // fallbacks
    const alike = { ...table, seats: [table.seats[0]!, seat({ playerId: 'pill', biasPts: 2, errorPts: 9, costPerDecisionUsd: 0.001, latencyMeanMs: 250 })] }
    const flat = researchMetrics(alike)
    expect(flat.some((x) => x.what.includes('every seat costs about the same'))).toBe(true)
    expect(flat.some((x) => x.what.includes('about the same speed'))).toBe(true)
    for (const x of researchMetrics(table)) expect(x.value).not.toMatch(/NaN|undefined|Infinity/)
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
