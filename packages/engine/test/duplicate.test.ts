import { describe, expect, it } from 'vitest'
import { cashHandConfig, duplicateGroup, seatRotations } from '../src/duplicate'
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

  it('starts every study hand at 100 big blinds with the button on seat 0', () => {
    const cfg = cashHandConfig(duplicateGroup('m', 0, players)[2]!)
    expect(cfg.seats.every((s) => s.stack === 10_000)).toBe(true)
    expect(cfg.buttonIndex).toBe(0)
    expect([cfg.smallBlind, cfg.bigBlind]).toEqual([50, 100])
  })
})
