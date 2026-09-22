import { describe, expect, it } from 'vitest'
import type { Card } from '../src/cards'
import { mainPotShares, mainPotSharesBySubset, remainingBoards, sampleMainPotShares } from '../src/equity'
import { evaluateHand } from '../src/evaluate'

const cards = (s: string) => (s ? (s.split(' ') as Card[]) : [])

/** Brute force with the engine's own evaluator: the reference for small enumerations. */
function bruteForce(holes: Card[][], board: Card[], deck: Card[]): number[] {
  const shares = holes.map(() => 0)
  let boards = 0
  const rec = (from: number, b: Card[]) => {
    if (b.length === 5) {
      boards++
      const v = holes.map((h) => evaluateHand([...h, ...b]).value)
      const best = Math.min(...v)
      const k = v.filter((x) => x === best).length
      v.forEach((x, i) => {
        if (x === best) shares[i]! += 1 / k
      })
      return
    }
    for (let i = from; i < deck.length; i++) rec(i + 1, [...b, deck[i]!])
  }
  rec(0, board)
  return shares.map((s) => s / boards)
}

describe('mainPotShares', () => {
  it('matches the known preflop equity of AA vs KK with matching suits', () => {
    // 82.64%: the best case for AA (KK's flushes are dominated). Checked by brute force over all 1,712,304 boards.
    const [aa, kk] = mainPotShares([cards('Ah As'), cards('Kh Ks')], [])
    expect(aa).toBeCloseTo(0.826366, 6)
    expect(kk).toBeCloseTo(0.173634, 6)
  })

  it('splits ties and is exact on the river', () => {
    expect(mainPotShares([cards('2c 3d'), cards('2d 3c')], cards('As Ks Qs Js Ts'))).toEqual([0.5, 0.5])
    expect(mainPotShares([cards('Ac Ad'), cards('Kc Kd'), cards('7h 2s')], cards('Ah Kh 9c 5d 3s'))).toEqual([1, 0, 0])
  })

  it('agrees with brute force on the flop and turn, three ways', () => {
    const holes = [cards('Ah Kh'), cards('Qd Qc'), cards('9h 8h')]
    for (const board of [cards('Jh Tc 2h'), cards('Jh Tc 2h 7d')]) {
      const used = new Set([...holes.flat(), ...board])
      const deck = (['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const)
        .flatMap((r) => (['s', 'h', 'd', 'c'] as const).map((s) => `${r}${s}` as Card))
        .filter((c) => !used.has(c))
      const exact = mainPotShares(holes, board)
      bruteForce(holes, board, deck).forEach((v, i) => expect(exact[i]).toBeCloseTo(v, 12))
      expect(exact.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
    }
  })

  it('handles five players preflop and sums to 1', () => {
    const shares = mainPotShares([cards('As Kd'), cards('Qh Qc'), cards('7s 6s'), cards('2d 2h'), cards('Jc Tc')], [])
    expect(shares.map((s) => Number(s.toFixed(4)))).toEqual([0.2248, 0.2596, 0.2033, 0.1379, 0.1744])
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
  })

  it('rejects bad input', () => {
    expect(() => mainPotShares([cards('Ah As')], [])).toThrow(/at least two/)
    expect(() => mainPotShares([cards('Ah As'), cards('Ah Ks')], [])).toThrow(/duplicate/)
    expect(() => mainPotShares([cards('Ah As'), cards('Kh Ks')], cards('2c 3c'))).toThrow(/0, 3, 4 or 5/)
    expect(() => mainPotShares([cards('Ah Xs'), cards('Kh Ks')], [])).toThrow(/malformed/)
    expect(() => mainPotShares([cards('Ah'), cards('Kh Ks')], [])).toThrow(/two hole cards/)
  })

  it('scores several subsets in one pass, with every dealt hole card dead', () => {
    const holes = [cards('As Kd'), cards('Qh Qc'), cards('7s 6s'), cards('2d 2h')]
    const board = cards('Jh Tc 2s')
    const subsets = [[0, 1, 2, 3], [0, 2], [3, 1, 0]]
    const batch = mainPotSharesBySubset(holes, board, subsets)
    const dead = new Set([...holes.flat(), ...board])
    const deck = (['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const)
      .flatMap((r) => (['s', 'h', 'd', 'c'] as const).map((s) => `${r}${s}` as Card))
      .filter((c) => !dead.has(c))
    subsets.forEach((sub, k) => {
      // Brute force over the same live deck: the folded players' cards (outside the subset) can't come.
      bruteForce(sub.map((i) => holes[i]!), board, deck).forEach((v, j) => expect(batch[k]![j]).toBeCloseTo(v, 12))
    })
    expect(batch[0]).toEqual(mainPotShares(holes, board))
    expect(() => mainPotSharesBySubset(holes, board, [[0]])).toThrow(/at least two/)
    expect(() => mainPotSharesBySubset(holes, board, [[0, 0]])).toThrow(/bad subset/)
    expect(() => mainPotSharesBySubset(holes, board, [[0, 9]])).toThrow(/bad subset/)
  })

  it('estimates shares by seeded sampling, close to the exact answer and reproducible', () => {
    const holes = [cards('As Kd'), cards('Qh Qc'), cards('7s 6s'), cards('2d 2h'), cards('Jc Tc')]
    const exact = mainPotSharesBySubset(holes, cards('Jh 5c 2s'), [[0, 1, 2, 3, 4]])[0]!
    const sampled = sampleMainPotShares(holes, cards('Jh 5c 2s'), [0, 1, 2, 3, 4], 20_000, 7)
    sampled.forEach((v, i) => expect(Math.abs(v - exact[i]!)).toBeLessThan(0.015))
    expect(sampled.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
    expect(sampleMainPotShares(holes, cards('Jh 5c 2s'), [0, 1, 2, 3, 4], 20_000, 7)).toEqual(sampled)
    // Folded hands stay dead: the subset's shares match exact enumeration over the same live deck.
    const headsUp = sampleMainPotShares(holes, cards('Jh 5c 2s'), [1, 4], 20_000, 3)
    const exactHeadsUp = mainPotSharesBySubset(holes, cards('Jh 5c 2s'), [[1, 4]])[0]!
    headsUp.forEach((v, i) => expect(Math.abs(v - exactHeadsUp[i]!)).toBeLessThan(0.015))
    expect(sampleMainPotShares(holes, cards('Jh 5c 2s'), [0, 1, 2, 3, 4], 20_000, 8)).not.toEqual(sampled) // another seed, another sample
    expect(() => sampleMainPotShares(holes, [], [0, 1], 0, 1)).toThrow(/samples/)
    expect(() => sampleMainPotShares(holes, [], [0], 10, 1)).toThrow(/at least two players/)
  })

  it('counts the boards still to come', () => {
    expect(remainingBoards(4, 0)).toBe(1_712_304) // heads-up preflop: C(48, 5)
    expect(remainingBoards(10, 0)).toBe(850_668) // five players preflop: C(42, 5)
    expect(remainingBoards(13, 3)).toBe(741) // five players on the flop: C(39, 2)
    expect(remainingBoards(15, 5)).toBe(1)
    expect(() => remainingBoards(10, 2)).toThrow(/bad input/)
    expect(() => remainingBoards(3, 0)).toThrow(/bad input/)
  })
})
