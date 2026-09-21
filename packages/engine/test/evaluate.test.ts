import { describe, expect, it } from 'vitest'
import { fullDeck, type Card } from '../src/cards'
import { compareHands, evaluateHand } from '../src/evaluate'
import { deriveSeed, shuffle } from '../src/rng'
import { compareScores, referenceScore7 } from './reference-evaluator'

const hand = (s: string) => s.split(' ') as Card[]
const value = (s: string) => evaluateHand(hand(s))

describe('evaluateHand', () => {
  it('names categories', () => {
    expect(value('As Ks Qs Js Ts 2c 3d').category).toBe('straight_flush')
    expect(value('9c 9d 9h 9s 2c 3d 4h').category).toBe('four_of_a_kind')
    expect(value('9c 9d 9h 2s 2c 3d 4h').category).toBe('full_house')
    expect(value('Ah 9h 7h 4h 2h Kc Qd').category).toBe('flush')
    expect(value('5c 6d 7h 8s 9c 2d 2h').category).toBe('straight')
    expect(value('7c 7d 7h Ks 2c 4d 9h').category).toBe('three_of_a_kind')
    expect(value('7c 7d Kh Ks 2c 4d 9h').category).toBe('two_pair')
    expect(value('7c 7d Kh Qs 2c 4d 9h').category).toBe('one_pair')
    expect(value('Ac Jd 9h 7s 5c 3d 2h').category).toBe('high_card')
  })

  it('rejects duplicates and wrong sizes', () => {
    expect(() => evaluateHand(hand('As As Ks Qs Js'))).toThrow(/duplicate/)
    expect(() => evaluateHand(hand('As Ks Qs Js'))).toThrow(/5-7/)
  })

  it('rejects malformed cards instead of mis-evaluating them', () => {
    expect(() => evaluateHand(hand('ts Ks Qs Js As'))).toThrow(/malformed/)
    expect(() => evaluateHand(hand('10s Ks Qs Js As'))).toThrow(/malformed/)
  })

  it('reports an exact tie as 0', () => {
    expect(compareHands(value('As Kd 2c 3d 7h 8s 9c'), value('Ac Kh 2c 3d 7h 8s 9c'))).toBe(0)
  })

  // Every case the salvaged Solidity HandEvaluator got wrong (see SALVAGE.md).
  describe('regressions from the on-chain evaluator', () => {
    it('ranks a six-high straight above the wheel', () => {
      expect(compareHands(value('2c 3d 4h 5s 6c Kd Kh'), value('Ac 2d 3h 4s 5c Kd Kh'))).toBeLessThan(0)
    })
    it('ranks a broadway straight flush above a lower one', () => {
      expect(compareHands(value('As Ks Qs Js Ts 2c 3d'), value('9s 8s 7s 6s 5s 2c 3d'))).toBeLessThan(0)
    })
    it('compares flushes by highest card first', () => {
      expect(compareHands(value('Ah 7h 5h 4h 2h Kc Qd'), value('Kh Qh Jh 9h 8h 2c 3d'))).toBeLessThan(0)
    })
    it('uses the highest kicker with quads', () => {
      expect(compareHands(value('9c 9d 9h 9s Ac 2d 3h'), value('9c 9d 9h 9s Kc 2d 3h'))).toBeLessThan(0)
    })
    it('uses the first kicker with trips', () => {
      expect(compareHands(value('7c 7d 7h Ks 2c 4d 3h'), value('7c 7d 7h Qs Jc 4d 3h'))).toBeLessThan(0)
    })
    it('weights pair kickers in order', () => {
      expect(compareHands(value('7c 7d Ah 3s 2c 4d 9h'), value('7c 7d Kh Qs Jc 4d 9h'))).toBeLessThan(0)
    })
  })

  it('agrees with a brute-force reference on 20,000 random 7-card hands', () => {
    const deck = fullDeck()
    const hands = Array.from({ length: 20_000 }, (_, i) => shuffle(deck, deriveSeed('eval', i)).slice(0, 7))
    for (let i = 1; i < hands.length; i++) {
      const a = hands[i - 1]!
      const b = hands[i]!
      // compareHands(b, a) > 0 means a is better; compareScores(a, b) > 0 means the same.
      const engine = Math.sign(compareHands(evaluateHand(b), evaluateHand(a)))
      const reference = Math.sign(compareScores(referenceScore7(a), referenceScore7(b)))
      expect(engine, `${a.join(' ')} vs ${b.join(' ')}`).toBe(reference)
    }
  })
})
