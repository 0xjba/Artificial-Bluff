import { describe, expect, it } from 'vitest'
import { cashHandConfig, duplicateGroup, handKey, neighbourBlockSize, seatRotations } from '../src/duplicate'
import { createHand } from '../src/hand'

const players = ['jev', 'pill', 'block', 'drip', 'nimbus']

describe('duplicate', () => {
  it('puts every player in every seat exactly once', () => {
    const rotations = seatRotations(players)
    expect(rotations).toHaveLength(5)
    for (let seat = 0; seat < 5; seat++) {
      expect(new Set(rotations.map((r) => r[seat])).size).toBe(5)
    }
  })

  it('shares one deck seed across a group, different across groups', () => {
    const g0 = duplicateGroup('m', 0, players)
    const g1 = duplicateGroup('m', 1, players)
    expect(new Set(g0.map((h) => h.seed)).size).toBe(1)
    expect(g0[0]!.seed).not.toBe(g1[0]!.seed)
    const seeds = Array.from({ length: 10_000 }, (_, g) => duplicateGroup('m', g, players)[0]!.seed)
    expect(new Set(seeds).size).toBe(10_000)
  })

  it('deals the same cards to the same seat in every rotation', () => {
    const hands = duplicateGroup('m', 7, players).map((d) => createHand(cashHandConfig(d)))
    for (let seat = 0; seat < 5; seat++) {
      const holes = hands.map((h) => h.seats[seat]!.hole.join(''))
      expect(new Set(holes).size).toBe(1)
    }
    const jevCards = hands.map((h) => h.seats.find((s) => s.id === 'jev')!.hole.join(''))
    expect(new Set(jevCards).size).toBe(5)
  })

  it('gives each player the button, small blind and big blind exactly once per group', () => {
    const group = duplicateGroup('m', 3, players)
    for (const role of [0, 1, 2]) {
      expect(new Set(group.map((h) => h.seating[role])).size).toBe(5)
    }
  })

  it('balances neighbours: over a block of 4 groups every ordered pair sits side by side once', () => {
    expect(neighbourBlockSize(5)).toBe(4)
    const leftOf = new Map<string, number>()
    for (let g = 0; g < 4; g++) {
      const seating = duplicateGroup('m', g, players)[0]!.seating
      for (let i = 0; i < 5; i++) {
        const key = `${seating[i]}>${seating[(i + 1) % 5]}`
        leftOf.set(key, (leftOf.get(key) ?? 0) + 1)
      }
    }
    expect(leftOf.size).toBe(20) // all 5 x 4 ordered pairs
    expect([...leftOf.values()].every((v) => v === 1)).toBe(true)
    expect(duplicateGroup('m', 0, players)[0]!.order).toBe(1)
    expect(duplicateGroup('m', 5, players)[0]!.order).toBe(2)
  })

  it('falls back to a seeded shuffle for non-prime player counts', () => {
    const four = ['a', 'b', 'c', 'd']
    expect(neighbourBlockSize(4)).toBe(1)
    const g = duplicateGroup('m', 2, four)
    expect(g[0]!.order).toBe(0)
    expect([...g[0]!.seating].sort()).toEqual(four)
    expect(duplicateGroup('m', 2, four)[0]!.seating).toEqual(g[0]!.seating)
  })

  it('validates inputs and exposes a stable hand key', () => {
    expect(() => duplicateGroup('m', -1, players)).toThrow(/groupIndex/)
    expect(() => duplicateGroup('m', 1.5, players)).toThrow(/groupIndex/)
    expect(() => duplicateGroup('m', 0, ['a'])).toThrow(/at least 2/)
    expect(() => duplicateGroup('m', 0, ['a', 'a'])).toThrow(/unique/)
    expect(handKey(duplicateGroup('m', 12, players)[3]!)).toBe('12:3')
  })

  it('starts every study hand at 100 big blinds with the button on seat 0', () => {
    const cfg = cashHandConfig(duplicateGroup('m', 0, players)[2]!)
    expect(cfg.seats.every((s) => s.stack === 10_000)).toBe(true)
    expect(cfg.buttonIndex).toBe(0)
    expect([cfg.smallBlind, cfg.bigBlind]).toEqual([50, 100])
  })
})
