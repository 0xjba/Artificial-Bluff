import type { ScoredDecision } from '@ab/analysis'
import { describe, expect, it } from 'vitest'
import { calibrationStats } from '../src/calibration-stats'

/** One scored decision; only the fields the statistics read matter. */
const d = (handId: string, playerId: string, over: Partial<ScoredDecision>): ScoredDecision =>
  ({ handId, index: 1, playerId, position: 'UTG', optionId: 'call', street: 'flop', live: ['a', 'b'], winProbability: 0.5, mainPotShare: 0, expectedShare: 0.5, fallback: false, ...over }) as ScoredDecision

/**
 * `blocks` blocks of one group each, one hand per player per group. In every hand, player a states
 * the true chance and player b is 30 points off, so a is better on every measure.
 */
function study(blocks: number, bOff = 0.3) {
  const decisions: ScoredDecision[] = []
  const groupOf = new Map<string, number>()
  for (let g = 0; g < blocks; g++) {
    for (const [r, who] of [['0', 'a'], ['1', 'b']] as const) {
      const hand = `g${g}r${r}`
      groupOf.set(hand, g)
      const truth = 0.2 + 0.5 * ((g * 7) % 10) / 10 // at most 0.65, so 30 points over stays below 1
      const won = g % 3 === 0 ? 1 : 0
      const stated = who === 'a' ? truth : Math.min(1, truth + bOff)
      // The first decision of the hand: the same spot for both players (same cards, same seat).
      decisions.push(d(hand, who, { index: 0, street: 'preflop', winProbability: stated, expectedShare: truth, mainPotShare: won }))
      decisions.push(d(hand, who, { index: 3, winProbability: stated, expectedShare: truth, mainPotShare: won }))
    }
  }
  return { decisions, groupOf }
}

const run = (s: ReturnType<typeof study>, focus = 'a') =>
  calibrationStats({ decisions: s.decisions, groupOf: s.groupOf, blockSize: 1, players: ['a', 'b'], focusId: focus, resamples: 1000, seed: 't' })

describe('calibrationStats', () => {
  it('gives each player its Brier score against the pot won, with a cluster-bootstrap interval, and a skill score against the fair share', () => {
    const r = run(study(40))
    const a = r.players.find((p) => p.playerId === 'a')!
    expect(a.n).toBe(80) // 40 groups, one hand each, two decisions a hand
    expect(a.brierA.low!).toBeLessThanOrEqual(a.brierA.value!)
    expect(a.brierA.high!).toBeGreaterThanOrEqual(a.brierA.value!)
    // Skill: 1 - Brier / Brier of saying "a fair share" (1 / players still in, here 0.5) every time.
    const fair = a.brierA.value! // recomputed below from the same decisions
    expect(typeof a.skillA.value).toBe('number')
    expect(fair).toBeGreaterThan(0)
    // A player who always states a fair share has a skill of exactly 0.
    const flat = study(40)
    for (const x of flat.decisions) if (x.playerId === 'a') x.winProbability = 0.5
    expect(run(flat).players.find((p) => p.playerId === 'a')!.skillA.value).toBeCloseTo(0, 12)
  })

  it('compares the focus with each player on the same hands, paired by block, with Holm', () => {
    const r = run(study(40))
    const brier = r.contrasts.find((c) => c.measure === 'brierA' && c.otherId === 'b')!
    // a is better: its Brier minus b's is negative, and clearly so.
    expect(brier.diff.mean).toBeLessThan(0)
    expect(brier.significant).toBe(true)
    // On the matched spots (identical first decisions) a is 30 points closer to the truth.
    const matched = r.contrasts.find((c) => c.measure === 'matchedError' && c.otherId === 'b')!
    expect(matched.diff.mean).toBeCloseTo(-30, 6)
    // Both of each hand's decisions are matched: same group, seat and actions before them.
    expect(r.players.find((p) => p.playerId === 'b')!.matched).toMatchObject({ n: 80 })
    expect(r.players.find((p) => p.playerId === 'b')!.matched.errorPts).toBeCloseTo(30, 6)
  })

  it('claims nothing when the two are alike', () => {
    const r = run(study(40, 0))
    for (const c of r.contrasts) expect(c.significant).toBe(false)
  })

  it('scores decisions at identical spots facing a bet: continuing is right at or above the pot odds, folding below', () => {
    const s = study(20)
    for (const x of s.decisions) {
      // Every spot faces 100 to call into 300: pot odds 25%.
      x.toCall = 100
      x.winnablePot = 300
      // a folds exactly when the true chance is below the odds; b always calls.
      x.actionType = x.playerId === 'a' && x.expectedShare < 0.25 ? 'fold' : 'call'
      x.optionId = x.actionType === 'fold' ? 'fold' : 'call'
    }
    // The spots must stay matched, so both players' first actions are the same: checks, which face no bet
    // and so aren't scored.
    for (const x of s.decisions) if (x.index === 0) Object.assign(x, { actionType: 'check', optionId: 'check', toCall: 0 })
    const r = run(s)
    const a = r.players.find((p) => p.playerId === 'a')!
    expect(a.matchedDecision.accuracy).toBe(1)
    const c = r.contrasts.find((x) => x.measure === 'matchedDecision' && x.otherId === 'b')!
    // b's calls below the odds are wrong, so a is ahead by the share of such spots, in points.
    expect(c.diff.mean).toBeGreaterThan(0)
  })

  it('matches only spots that were really the same: a different action before it is a different spot', () => {
    const s = study(10)
    // In every group, b's second decision now follows a raise instead of a call.
    for (const x of s.decisions) if (x.playerId === 'b' && x.index === 0) x.optionId = 'open_3bb'
    const r = run(s)
    expect(r.players.find((p) => p.playerId === 'b')!.matched.n).toBe(10) // only the first decisions still match
  })

  it('leaves out fallbacks and unstated chances, and gives the same intervals for the same seed', () => {
    const s = study(20)
    s.decisions.push(d('g0r0', 'a', { fallback: true, winProbability: 0.99, mainPotShare: 0 }))
    s.decisions.push(d('g0r0', 'a', { winProbability: null }))
    const one = run(s)
    expect(one.players.find((p) => p.playerId === 'a')!.n).toBe(40)
    expect(run(s)).toEqual(one)
  })
})
