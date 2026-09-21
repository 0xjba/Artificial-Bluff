import { describe, expect, it } from 'vitest'
import { buildPots, splitPot } from '../src/pots'

describe('buildPots', () => {
  it('makes one pot when everyone contributes equally', () => {
    expect(
      buildPots([
        { id: 'a', amount: 100, folded: false },
        { id: 'b', amount: 100, folded: false },
      ]),
    ).toEqual([{ amount: 200, eligible: ['a', 'b'] }])
  })

  it('builds side pots for three all-ins at different levels', () => {
    const pots = buildPots([
      { id: 'a', amount: 50, folded: false },
      { id: 'b', amount: 200, folded: false },
      { id: 'c', amount: 500, folded: false },
      { id: 'd', amount: 500, folded: false },
    ])
    expect(pots).toEqual([
      { amount: 200, eligible: ['a', 'b', 'c', 'd'] },
      { amount: 450, eligible: ['b', 'c', 'd'] },
      { amount: 600, eligible: ['c', 'd'] },
    ])
  })

  it('counts folded chips once, in the levels they reach', () => {
    const pots = buildPots([
      { id: 'a', amount: 100, folded: false },
      { id: 'f', amount: 300, folded: true },
      { id: 'b', amount: 300, folded: false },
    ])
    expect(pots).toEqual([
      { amount: 300, eligible: ['a', 'b'] },
      { amount: 400, eligible: ['b'] },
    ])
    expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(700)
  })

  it('returns an uncalled bet as a single-eligible pot', () => {
    expect(
      buildPots([
        { id: 'a', amount: 1000, folded: false },
        { id: 'b', amount: 400, folded: false },
      ]),
    ).toEqual([
      { amount: 800, eligible: ['a', 'b'] },
      { amount: 600, eligible: ['a'] },
    ])
  })
})

describe('splitPot', () => {
  it('splits evenly', () => {
    expect(splitPot(300, ['a', 'b'])).toEqual({ a: 150, b: 150 })
  })
  it('gives odd chips to the earliest winners in order', () => {
    expect(splitPot(175, ['b', 'a'])).toEqual({ b: 88, a: 87 })
    expect(splitPot(100, ['x', 'y', 'z'])).toEqual({ x: 34, y: 33, z: 33 })
  })
})
