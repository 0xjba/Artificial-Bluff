import { describe, expect, it } from 'vitest'
import { applyAction, createHand, legalActions } from '../src/hand'
import {
  createTournament,
  tournamentHandId,
  currentLevel,
  endTournament,
  liveTurboConfig,
  nextHandConfig,
  recordHand,
  type TournamentConfig,
  type TournamentState,
} from '../src/tournament'
import type { HandResult } from '../src/types'

const ids = ['jev', 'pill', 'block', 'drip', 'nimbus']

function result(stacks: Record<string, number>): HandResult {
  return { handId: null, showdown: false, awards: [], hands: {}, board: [], stacks, net: {} }
}

/** Records a synthetic result as the tournament's current hand. */
const rec = (t: TournamentState, r: HandResult) => recordHand(t, { ...r, handId: tournamentHandId(t.handNumber) })

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
    for (let i = 0; i < 8; i++) t = rec(t, result(same))
    expect(currentLevel(t)).toEqual({ smallBlind: 50, bigBlind: 100 })
    for (let i = 0; i < 8; i++) t = rec(t, result(same))
    expect(currentLevel(t)).toEqual({ smallBlind: 75, bigBlind: 150 })
  })

  it('rotates the button clockwise, skipping busted players', () => {
    let t = createTournament(ids, liveTurboConfig('s'))
    t = rec(t, result({ jev: 6000, pill: 0, block: 3000, drip: 3000, nimbus: 3000 }))
    expect(t.buttonSeat).toBe(2) // seat 1 (pill) is out
    const cfg = nextHandConfig(t)
    expect(cfg.seats.map((s) => s.id)).toEqual(['jev', 'block', 'drip', 'nimbus'])
    expect(cfg.buttonIndex).toBe(1)
  })

  it('records eliminations, shorter starting stack out first', () => {
    let t = createTournament(['a', 'b', 'c'], liveTurboConfig('s'))
    t = rec(t, result({ a: 1000, b: 3000, c: 5000 }))
    t = rec(t, result({ a: 0, b: 0, c: 9000 }))
    expect(t.eliminated).toEqual(['a', 'b'])
    expect(t.complete).toBe(true)
    expect(t.winner).toBe('c')
    expect(t.endReason).toBe('last_player')
  })

  it('ends at the hand cap with the chip leader as winner', () => {
    let t = createTournament(['a', 'b'], { ...liveTurboConfig('s'), maxHands: 3 })
    t = rec(t, result({ a: 2000, b: 4000 }))
    t = rec(t, result({ a: 2500, b: 3500 }))
    t = rec(t, result({ a: 2400, b: 3600 }))
    expect(t.complete).toBe(true)
    expect(t.winner).toBe('b')
    expect(t.endReason).toBe('hand_cap')
    expect(() => nextHandConfig(t)).toThrow(/complete/)
  })

  it('rejects a hand result that does not match the live players or loses chips', () => {
    let t = createTournament(['a', 'b', 'c'], liveTurboConfig('s'))
    expect(() => rec(t, result({ a: 4500, b: 4500 }))).toThrow(/do not match/)
    expect(() => rec(t, result({ a: 3000, b: 3000, c: 3000, x: 0 }))).toThrow(/do not match/)
    expect(() => rec(t, result({ a: 3000, b: 3000, c: 2000 }))).toThrow(/conserve chips/)
    t = rec(t, result({ a: 0, b: 4500, c: 4500 }))
    // 'a' is out: a result that includes 'a' again (e.g. a stale result) must be rejected.
    expect(() => rec(t, result({ a: 100, b: 4400, c: 4500 }))).toThrow(/do not match/)
  })

  it('tags hands with an id and rejects a result from a different hand', () => {
    let t = createTournament(['a', 'b'], liveTurboConfig('s'))
    expect(nextHandConfig(t).handId).toBe('hand-0')
    const first = { ...result({ a: 2000, b: 4000 }), handId: 'hand-0' }
    t = recordHand(t, first)
    expect(nextHandConfig(t).handId).toBe('hand-1')
    expect(() => recordHand(t, first)).toThrow(/not for the current hand/)
    expect(() => recordHand(t, { ...first, handId: null })).toThrow(/not for the current hand/)
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
    const a2 = rec(a, result(Object.fromEntries(ids.map((id) => [id, 3000]))))
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

describe('createTournament validation', () => {
  const validConfig: TournamentConfig = liveTurboConfig('s')

  it('throws if levels is empty', () => {
    expect(() => createTournament(['a', 'b'], { ...validConfig, levels: [] })).toThrow(/level/i)
  })

  it("throws if a level's blinds are not positive integers", () => {
    expect(() =>
      createTournament(['a', 'b'], { ...validConfig, levels: [{ smallBlind: 0, bigBlind: 50 }] }),
    ).toThrow(/blind/i)
    expect(() =>
      createTournament(['a', 'b'], { ...validConfig, levels: [{ smallBlind: -25, bigBlind: 50 }] }),
    ).toThrow(/blind/i)
    expect(() =>
      createTournament(['a', 'b'], { ...validConfig, levels: [{ smallBlind: 25.5, bigBlind: 50 }] }),
    ).toThrow(/blind/i)
    expect(() =>
      createTournament(['a', 'b'], { ...validConfig, levels: [{ smallBlind: 25, bigBlind: 0 }] }),
    ).toThrow(/blind/i)
    expect(() =>
      createTournament(['a', 'b'], { ...validConfig, levels: [{ smallBlind: 25, bigBlind: 50.5 }] }),
    ).toThrow(/blind/i)
  })

  it('throws if a level has bigBlind < smallBlind', () => {
    expect(() =>
      createTournament(['a', 'b'], { ...validConfig, levels: [{ smallBlind: 50, bigBlind: 25 }] }),
    ).toThrow(/blind/i)
  })

  it('throws if handsPerLevel is less than 1 or not an integer', () => {
    expect(() => createTournament(['a', 'b'], { ...validConfig, handsPerLevel: 0 })).toThrow(/handsPerLevel/)
    expect(() => createTournament(['a', 'b'], { ...validConfig, handsPerLevel: -1 })).toThrow(/handsPerLevel/)
    expect(() => createTournament(['a', 'b'], { ...validConfig, handsPerLevel: 1.5 })).toThrow(/handsPerLevel/)
  })

  it('throws if maxHands is less than 1 or not an integer', () => {
    expect(() => createTournament(['a', 'b'], { ...validConfig, maxHands: 0 })).toThrow(/maxHands/)
    expect(() => createTournament(['a', 'b'], { ...validConfig, maxHands: -1 })).toThrow(/maxHands/)
    expect(() => createTournament(['a', 'b'], { ...validConfig, maxHands: 2.5 })).toThrow(/maxHands/)
  })

  it('throws if startingStack is less than 1 or not an integer', () => {
    expect(() => createTournament(['a', 'b'], { ...validConfig, startingStack: 0 })).toThrow(/startingStack/)
    expect(() => createTournament(['a', 'b'], { ...validConfig, startingStack: -100 })).toThrow(/startingStack/)
    expect(() => createTournament(['a', 'b'], { ...validConfig, startingStack: 1.5 })).toThrow(/startingStack/)
  })

  it('stores a deep copy of the config, decoupled from the caller', () => {
    const config: TournamentConfig = {
      startingStack: 3000,
      levels: [
        { smallBlind: 25, bigBlind: 50 },
        { smallBlind: 50, bigBlind: 100 },
      ],
      handsPerLevel: 8,
      maxHands: 120,
      seed: 'decouple',
    }
    const t = createTournament(['a', 'b'], config)

    config.levels[0]!.smallBlind = 999_999
    config.levels.push({ smallBlind: 1, bigBlind: 2 })
    config.handsPerLevel = 999
    config.startingStack = 1

    expect(t.config.levels).toEqual([
      { smallBlind: 25, bigBlind: 50 },
      { smallBlind: 50, bigBlind: 100 },
    ])
    expect(t.config.handsPerLevel).toBe(8)
    expect(t.config.startingStack).toBe(3000)
    expect(currentLevel(t)).toEqual({ smallBlind: 25, bigBlind: 50 })
    expect(nextHandConfig(t).smallBlind).toBe(25)
    expect(t.players.every((p) => p.stack === 3000)).toBe(true)
  })
})
