import { describe, expect, it } from 'vitest'
import { BotEngine } from '../src/engine/engine'
import { SHAPES } from '../src/engine/skins'
import { STATES } from '../src/engine/states'

describe('shape rule', () => {
  it('never modifies the shared shape profiles while animating', () => {
    const before = SHAPES.map((s) => [...s.radii])
    for (const shape of SHAPES) {
      for (const state of STATES) {
        const e = new BotEngine(100, state.id, shape.radii)
        for (let t = 0; t < 4; t += 0.25) e.sample(t)
      }
    }
    expect(SHAPES.map((s) => [...s.radii])).toEqual(before)
  })
})
