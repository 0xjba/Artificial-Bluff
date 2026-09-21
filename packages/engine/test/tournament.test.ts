import { describe, expect, it } from 'vitest'
import { applyAction, createHand, legalActions } from '../src/hand'
import {
  createTournament,
  currentLevel,
  endTournament,
  liveTurboConfig,
  nextHandConfig,
  recordHand,
  type TournamentState,
} from '../src/tournament'
import type { HandResult } from '../src/types'

const ids = ['jev', 'pill', 'block', 'drip', 'nimbus']

function result(stacks: Record<string, number>): HandResult {
  return { showdown: false, awards: [], hands: {}, board: [], stacks, net: {} }
}

describe('tournament', () => {
  it('starts everyone at 3,000 with blinds 25/50 and the button on seat 0', () => {
    const t = createTournament(ids, liveTurboConfig('s'))
    const cfg = nextHandConfig(t)
    expect(cfg.seats.map((s) => s.stack)).toEqual([3000, 3000, 3000, 3000, 3000])
    expect([cfg.smallBlind, cfg.bigBlind]).toEqual([25, 50])
    expect(cfg.buttonIndex).toBe(0)
  })

  it('raises blinds every 8 hands', () => {
    let t = createTournament(ids, liveTurboConfig('s'))
    const same = Object.fromEntries(ids.map((id) => [id, 3000]))
    for (let i = 0; i < 8; i++) t = recordHand(t, result(same))
    expect(currentLevel(t)).toEqual({ smallBlind: 50, bigBlind: 100 })
    for (let i = 0; i < 8; i++) t = recordHand(t, result(same))
    expect(currentLevel(t)).toEqual({ smallBlind: 75, bigBlind: 150 })
  })

  it('rotates the button clockwise, skipping busted players', () => {
    let t = createTournament(ids, liveTurboConfig('s'))
    t = recordHand(t, result({ jev: 6000, pill: 0, block: 3000, drip: 3000, nimbus: 3000 }))
    expect(t.buttonSeat).toBe(2) // seat 1 (pill) is out
    const cfg = nextHandConfig(t)
    expect(cfg.seats.map((s) => s.id)).toEqual(['jev', 'block', 'drip', 'nimbus'])
    expect(cfg.buttonIndex).toBe(1)
  })

  it('records eliminations, shorter starting stack out first', () => {
    let t = createTournament(['a', 'b', 'c'], liveTurboConfig('s'))
    t = recordHand(t, result({ a: 1000, b: 3000, c: 5000 }))
    t = recordHand(t, result({ a: 0, b: 0, c: 9000 }))
    expect(t.eliminated).toEqual(['a', 'b'])
    expect(t.complete).toBe(true)
    expect(t.winner).toBe('c')
    expect(t.endReason).toBe('last_player')
  })

  it('ends at the hand cap with the chip leader as winner', () => {
    let t = createTournament(['a', 'b'], { ...liveTurboConfig('s'), maxHands: 3 })
    t = recordHand(t, result({ a: 2000, b: 4000 }))
    t = recordHand(t, result({ a: 2500, b: 3500 }))
    t = recordHand(t, result({ a: 2400, b: 3600 }))
    expect(t.complete).toBe(true)
    expect(t.winner).toBe('b')
    expect(t.endReason).toBe('hand_cap')
    expect(() => nextHandConfig(t)).toThrow(/complete/)
  })

  it('rejects a hand result that does not match the live players or loses chips', () => {
    let t = createTournament(['a', 'b', 'c'], liveTurboConfig('s'))
    expect(() => recordHand(t, result({ a: 4500, b: 4500 }))).toThrow(/do not match/)
    expect(() => recordHand(t, result({ a: 3000, b: 3000, c: 3000, x: 0 }))).toThrow(/do not match/)
    expect(() => recordHand(t, result({ a: 3000, b: 3000, c: 2000 }))).toThrow(/conserve chips/)
    t = recordHand(t, result({ a: 0, b: 4500, c: 4500 }))
    // 'a' is out: a result that includes 'a' again (e.g. a stale result) must be rejected.
    expect(() => recordHand(t, result({ a: 100, b: 4400, c: 4500 }))).toThrow(/do not match/)
  })

  it('allows at most 10 players', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `p${i}`)
    expect(() => createTournament(eleven, liveTurboConfig('s'))).toThrow(/at most 10/)
  })

  it('can be ended early for the budget cap', () => {
    const t = endTournament(createTournament(['a', 'b'], liveTurboConfig('s')), 'budget_cap')
    expect(t.complete).toBe(true)
    expect(t.endReason).toBe('budget_cap')
  })

  it('derives a different deck seed per hand, stable per master seed', () => {
    const a = createTournament(ids, liveTurboConfig('x'))
    const b = createTournament(ids, liveTurboConfig('x'))
    expect(nextHandConfig(a).seed).toBe(nextHandConfig(b).seed)
    const a2 = recordHand(a, result(Object.fromEntries(ids.map((id) => [id, 3000]))))
    expect(nextHandConfig(a2).seed).not.toBe(nextHandConfig(a).seed)
  })

  it('plays a full tournament to completion with a simple bot, conserving chips', () => {
    let t: TournamentState = createTournament(ids, liveTurboConfig('full'))
    while (!t.complete) {
      let h = createHand(nextHandConfig(t))
      // Bot: shove (or call when raising isn't allowed) with any pair or an ace, otherwise check/fold.
      while (!h.complete) {
        const [x, y] = h.seats[h.toAct!]!.hole
        const strong = x![0] === y![0] || x![0] === 'A' || y![0] === 'A'
        const legal = legalActions(h)
        if (strong && legal.maxRaiseTo !== null) h = applyAction(h, { type: 'raise', to: legal.maxRaiseTo })
        else if (strong && legal.callAmount > 0) h = applyAction(h, { type: 'call' })
        else h = applyAction(h, legal.canCheck ? { type: 'check' } : { type: 'fold' })
      }
      t = recordHand(t, h.result!)
      expect(t.players.reduce((s, p) => s + p.stack, 0)).toBe(15_000)
    }
    expect(t.winner).not.toBeNull()
    expect(t.handNumber).toBeLessThanOrEqual(120)
  })
})
