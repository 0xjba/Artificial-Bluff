import { describe, expect, it } from 'vitest'
import { applyAction, createHand } from '../src/hand'
import { buildMenu } from '../src/menu'
import { deriveSeed, mulberry32 } from '../src/rng'

describe('random play invariants', () => {
  it('holds over 3,000 random hands', () => {
    for (let h = 0; h < 3000; h++) {
      const rand = mulberry32(deriveSeed('prop', h))
      const n = 2 + Math.floor(rand() * 4)
      const seats = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, stack: 25 * (1 + Math.floor(rand() * 400)) }))
      const total = seats.reduce((s, x) => s + x.stack, 0)
      let state = createHand({
        seats,
        buttonIndex: Math.floor(rand() * n),
        smallBlind: 25,
        bigBlind: 50,
        seed: deriveSeed('deck', h),
      })
      let steps = 0
      while (!state.complete) {
        const menu = buildMenu(state)
        expect(menu.length).toBeGreaterThan(0)
        const pick = menu[Math.floor(rand() * menu.length)]!
        state = applyAction(state, pick.action)
        const inPlay = state.seats.reduce((s, x) => s + x.stack + x.handCommitted, 0)
        if (!state.complete) {
          expect(inPlay).toBe(total)
          const next = state.seats[state.toAct!]!
          expect(next.folded || next.allIn).toBe(false)
        }
        expect(++steps).toBeLessThan(200)
      }
      const r = state.result!
      expect(Object.values(r.stacks).reduce((a, b) => a + b, 0)).toBe(total)
      expect(Object.values(r.net).reduce((a, b) => a + b, 0)).toBe(0)
      expect(r.awards.reduce((s, a) => s + a.amount, 0)).toBe(state.seats.reduce((s, x) => s + x.handCommitted, 0))
      const cards = [...state.seats.flatMap((s) => s.hole), ...state.board, ...state.deck]
      expect(new Set(cards).size).toBe(cards.length)
      expect(state.board.length === 5 || !r.showdown).toBe(true)
    }
  })
})
