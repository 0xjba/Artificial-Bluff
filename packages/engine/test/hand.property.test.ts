import { describe, expect, it } from 'vitest'
import { evaluateHand } from '../src/evaluate'
import { applyAction, createHand, legalActions } from '../src/hand'
import { buildMenu } from '../src/menu'
import { deriveSeed, mulberry32 } from '../src/rng'
import type { Action, HandConfig, HandState } from '../src/types'

const MIXED_BLINDS: Array<[number, number]> = [
  [25, 50],
  [50, 100],
  [1, 2],
  [5, 10],
  [15, 30],
  [150, 300],
]

/** n in 2..10, blinds from MIXED_BLINDS, stacks as random multiples of the small blind from 1 to 300 big blinds. */
function randomWideHandConfig(rand: () => number, h: number): HandConfig {
  const n = 2 + Math.floor(rand() * 9)
  const [smallBlind, bigBlind] = MIXED_BLINDS[Math.floor(rand() * MIXED_BLINDS.length)]!
  const minMult = Math.ceil(bigBlind / smallBlind)
  const maxMult = Math.floor((300 * bigBlind) / smallBlind)
  const seats = Array.from({ length: n }, (_, i) => {
    const mult = minMult + Math.floor(rand() * (maxMult - minMult + 1))
    return { id: `p${i}`, stack: mult * smallBlind }
  })
  return {
    seats,
    buttonIndex: Math.floor(rand() * n),
    smallBlind,
    bigBlind,
    seed: deriveSeed('wide-deck', h),
  }
}

/**
 * 30% of the time, if raising is legal, raises to a uniformly random integer in
 * [minRaiseTo, maxRaiseTo] (an "off-menu" size); otherwise picks uniformly from buildMenu.
 */
function pickAction(state: HandState, rand: () => number): Action {
  const legal = legalActions(state)
  const wantsOffMenuRaise = rand() < 0.3
  if (wantsOffMenuRaise && legal.minRaiseTo !== null && legal.maxRaiseTo !== null) {
    const span = legal.maxRaiseTo - legal.minRaiseTo
    const to = legal.minRaiseTo + Math.floor(rand() * (span + 1))
    return { type: 'raise', to }
  }
  const menu = buildMenu(state)
  return menu[Math.floor(rand() * menu.length)]!.action
}

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

  it('holds with 2-10 players, mixed blinds and off-menu raises', () => {
    for (let h = 0; h < 2000; h++) {
      const rand = mulberry32(deriveSeed('wide', h))
      const config = randomWideHandConfig(rand, h)
      const total = config.seats.reduce((s, x) => s + x.stack, 0)
      let state = createHand(config)
      let steps = 0
      while (!state.complete) {
        const action = pickAction(state, rand)
        state = applyAction(state, action)
        const inPlay = state.seats.reduce((s, x) => s + x.stack + x.handCommitted, 0)
        if (!state.complete) {
          expect(inPlay).toBe(total)
          const next = state.seats[state.toAct!]!
          expect(next.folded || next.allIn).toBe(false)
        }
        expect(++steps).toBeLessThan(5000)
      }

      const r = state.result!
      expect(Object.values(r.stacks).reduce((a, b) => a + b, 0)).toBe(total)

      for (const award of r.awards) {
        // A single-eligible pot is its own winner; otherwise winners are exactly the
        // eligible players holding the best (lowest) hands[id].value.
        const expectedWinners =
          award.eligible.length === 1
            ? [...award.eligible]
            : (() => {
                const best = Math.min(...award.eligible.map((id) => r.hands[id]!.value))
                return award.eligible.filter((id) => r.hands[id]!.value === best)
              })()
        expect([...award.winners].sort()).toEqual([...expectedWinners].sort())

        // Hand values only exist when there was a showdown; when the hand ended by
        // everyone else folding, there is nothing to re-evaluate against.
        if (r.showdown) {
          for (const w of award.winners) {
            const seat = state.seats.find((s) => s.id === w)!
            expect(r.hands[w]!.value).toBe(evaluateHand([...seat.hole, ...state.board]).value)
          }
        }
      }
    }
  })

  it('replays identically from seed and recorded actions', () => {
    for (let h = 0; h < 200; h++) {
      const rand = mulberry32(deriveSeed('replay', h))
      const config = randomWideHandConfig(rand, h)

      let state = createHand(config)
      const actions: Action[] = []
      const snapshots: HandState[] = [state]
      let steps = 0
      while (!state.complete) {
        const action = pickAction(state, rand)
        actions.push(action)
        state = applyAction(state, action)
        snapshots.push(state)
        expect(++steps).toBeLessThan(5000)
      }

      let replay = createHand(config)
      expect(JSON.parse(JSON.stringify(snapshots[0]))).toEqual(replay)
      for (let i = 0; i < actions.length; i++) {
        replay = applyAction(replay, actions[i]!)
        expect(JSON.parse(JSON.stringify(snapshots[i + 1]))).toEqual(replay)
      }
      expect(replay).toEqual(state)
    }
  })
})
