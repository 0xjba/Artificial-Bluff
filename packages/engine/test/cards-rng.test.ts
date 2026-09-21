import { describe, expect, it } from 'vitest'
import { fullDeck, isCard, rankValue } from '../src/cards'
import { deriveSeed, mulberry32, shuffle } from '../src/rng'

describe('cards', () => {
  it('builds 52 unique cards', () => {
    const deck = fullDeck()
    expect(deck).toHaveLength(52)
    expect(new Set(deck).size).toBe(52)
    expect(deck.every(isCard)).toBe(true)
  })

  it('ranks deuce lowest and ace highest', () => {
    expect(rankValue('2c')).toBe(0)
    expect(rankValue('As')).toBe(12)
  })
})

describe('rng', () => {
  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 1000; i++) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })

  it('shuffle is deterministic per seed, a permutation, and non-mutating', () => {
    const deck = fullDeck()
    const s1 = shuffle(deck, 7)
    expect(shuffle(deck, 7)).toEqual(s1)
    expect(shuffle(deck, 8)).not.toEqual(s1)
    expect([...s1].sort()).toEqual([...deck].sort())
    expect(deck).toEqual(fullDeck())
  })

  it('deriveSeed separates keys and is stable', () => {
    expect(deriveSeed('study', 1)).toBe(deriveSeed('study', 1))
    expect(deriveSeed('study', 1)).not.toBe(deriveSeed('study', 2))
    expect(deriveSeed('a', 12)).not.toBe(deriveSeed('a1', 2))
    expect(deriveSeed('a:1', 2)).not.toBe(deriveSeed('a', '1:2'))
  })

  it('shuffle spreads the ace of spades roughly evenly', () => {
    const counts = new Array(52).fill(0)
    for (let seed = 0; seed < 52_000; seed++) counts[shuffle(fullDeck(), deriveSeed('u', seed)).indexOf('As')]++
    for (const c of counts) expect(Math.abs(c - 1000)).toBeLessThan(160)
  })
})
