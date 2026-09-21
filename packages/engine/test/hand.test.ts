import { describe, expect, it } from 'vitest'
import type { Card } from '../src/cards'
import { applyAction, createHand, legalActions, potSize } from '../src/hand'
import type { Action, HandConfig, HandState } from '../src/types'
import { arrangeDeck } from './helpers'

const c = (s: string) => s.split(' ') as Card[]

function hand(stacks: number[], opts: Partial<HandConfig> & { holes?: string[]; board?: string } = {}): HandState {
  const buttonIndex = opts.buttonIndex ?? 0
  const holes = opts.holes?.map(c)
  return createHand({
    seats: stacks.map((stack, i) => ({ id: `p${i}`, stack })),
    buttonIndex,
    smallBlind: opts.smallBlind ?? 50,
    bigBlind: opts.bigBlind ?? 100,
    seed: opts.seed ?? 1,
    deck: holes ? arrangeDeck(buttonIndex, holes, opts.board ? c(opts.board) : []) : undefined,
  })
}

function play(state: HandState, ...actions: Action[]): HandState {
  return actions.reduce((s, a) => applyAction(s, a), state)
}

const fold: Action = { type: 'fold' }
const check: Action = { type: 'check' }
const call: Action = { type: 'call' }
const raise = (to: number): Action => ({ type: 'raise', to })

describe('blinds and first to act', () => {
  it('3+ players: SB and BB after the button, UTG acts first', () => {
    const s = hand([1000, 1000, 1000, 1000])
    expect(s.seats.map((x) => x.streetCommitted)).toEqual([0, 50, 100, 0])
    expect(s.toAct).toBe(3)
    expect(s.currentBet).toBe(100)
  })

  it('heads-up: button posts SB and acts first preflop, last postflop', () => {
    let s = hand([1000, 1000], { buttonIndex: 0 })
    expect(s.seats.map((x) => x.streetCommitted)).toEqual([50, 100])
    expect(s.toAct).toBe(0)
    s = play(s, call, check)
    expect(s.street).toBe('flop')
    expect(s.toAct).toBe(1)
  })

  it('gives the big blind the option when everyone limps', () => {
    let s = hand([1000, 1000, 1000])
    s = play(s, call, call)
    expect(s.street).toBe('preflop')
    expect(s.toAct).toBe(2)
    expect(legalActions(s).canCheck).toBe(true)
    expect(legalActions(s).minRaiseTo).toBe(200)
  })

  it('short blind posts all-in for what it has', () => {
    const s = hand([1000, 30, 1000])
    expect(s.seats[1]!.streetCommitted).toBe(30)
    expect(s.seats[1]!.allIn).toBe(true)
  })

  it('postflop action starts left of the button', () => {
    let s = hand([1000, 1000, 1000, 1000], { buttonIndex: 2 })
    s = play(s, call, call, call, check)
    expect(s.street).toBe('flop')
    expect(s.toAct).toBe(3)
  })
})

describe('raising rules', () => {
  it('min raise equals the last raise size', () => {
    let s = hand([5000, 5000, 5000])
    s = play(s, raise(350)) // raise of 250
    expect(legalActions(s).minRaiseTo).toBe(600)
    expect(() => play(s, raise(500))).toThrow(/below minimum/)
  })

  it('rejects raises over the stack and non-integers', () => {
    const s = hand([1000, 1000, 1000])
    expect(() => play(s, raise(1001))).toThrow(/exceeds all-in/)
    expect(() => play(s, raise(250.5))).toThrow(/integer/)
  })

  it('allows an all-in below the minimum raise', () => {
    let s = hand([150, 1000, 1000])
    s = play(s, raise(150))
    expect(s.currentBet).toBe(150)
    expect(s.seats[0]!.allIn).toBe(true)
  })

  it('an incomplete all-in raise does not reopen betting for players who acted', () => {
    // p3 raises to 300 (full raise of 200). p0 has 400 and shoves: a 100 raise, less than 200.
    let s = hand([400, 5000, 5000, 5000])
    s = play(s, raise(300), raise(400), call, call)
    expect(s.toAct).toBe(3)
    const legal = legalActions(s)
    expect(legal.callAmount).toBe(100)
    expect(legal.minRaiseTo).toBeNull()
    expect(() => play(s, raise(1000))).toThrow(/not allowed/)
  })

  it('a full raise reopens betting', () => {
    let s = hand([5000, 5000, 5000, 5000])
    s = play(s, raise(300), raise(600), call, call)
    expect(s.toAct).toBe(3)
    expect(legalActions(s).minRaiseTo).toBe(900)
  })

  it('nobody may raise when every opponent is all-in', () => {
    // Heads-up: p0 (button, SB) limps, p1 (BB) shoves 500. p0 can only call or fold.
    let s = hand([5000, 500])
    s = play(s, call, raise(500))
    expect(s.toAct).toBe(0)
    expect(legalActions(s)).toMatchObject({ canFold: true, callAmount: 400, minRaiseTo: null, maxRaiseTo: null })
  })

  it('bets on a new street are "bet", later ones "raise"', () => {
    let s = hand([5000, 5000])
    s = play(s, call, check, raise(200), raise(600))
    const kinds = s.history.filter((h) => h.street === 'flop').map((h) => h.kind)
    expect(kinds).toEqual(['bet', 'raise'])
  })

  it('fold is illegal when checking is free, check is illegal facing a bet', () => {
    let s = hand([1000, 1000, 1000])
    expect(() => play(s, check)).toThrow(/facing a bet/)
    s = play(s, call, call)
    expect(() => play(s, fold)).toThrow(/check instead/)
  })
})

describe('hand completion', () => {
  it('awards the pot uncontested when everyone folds', () => {
    let s = hand([1000, 1000, 1000])
    s = play(s, raise(300), fold, fold)
    expect(s.complete).toBe(true)
    expect(s.result!.showdown).toBe(false)
    expect(s.result!.net).toEqual({ p0: 150, p1: -50, p2: -100 })
  })

  it('goes to showdown and pays the best hand', () => {
    let s = hand([1000, 1000], {
      holes: ['As Ad', 'Kc Kd'],
      board: '2c 7h 9s Jd 3c',
    })
    s = play(s, call, check, check, check, check, check, check, check)
    expect(s.complete).toBe(true)
    expect(s.result!.showdown).toBe(true)
    expect(s.result!.stacks).toEqual({ p0: 1100, p1: 900 })
    expect(s.board).toEqual(c('2c 7h 9s Jd 3c'))
  })

  it('runs the board out when all-in before the river', () => {
    let s = hand([1000, 1000], { holes: ['As Ad', 'Kc Kd'], board: '2c 7h 9s Jd 3c' })
    s = play(s, raise(1000), call)
    expect(s.complete).toBe(true)
    expect(s.board).toHaveLength(5)
    expect(s.result!.stacks).toEqual({ p0: 2000, p1: 0 })
  })

  it('splits a chopped pot and gives the odd chip left of the button', () => {
    // Both remaining players play the broadway straight on board. Blinds 1/3 make the pot odd.
    let s = hand([1000, 1000, 1000], {
      buttonIndex: 0,
      smallBlind: 1,
      bigBlind: 3,
      holes: ['2c 3d', '2d 3c', '4h 5h'],
      board: 'Ts Js Qd Kc Ah',
    })
    // p0 (button) raises to 6, p1 (SB) calls, p2 (BB) folds. Pot = 6 + 6 + 3 = 15.
    s = play(s, raise(6), call, fold)
    s = play(s, check, check, check, check, check, check)
    expect(s.result!.awards[0]!.winners).toEqual(['p1', 'p0'])
    expect(s.result!.stacks).toEqual({ p0: 1001, p1: 1002, p2: 997 })
  })

  it('pays side pots to the right players', () => {
    // p0 short all-in with the best hand wins only the main pot.
    let s = hand([200, 1000, 1000], {
      buttonIndex: 0,
      holes: ['As Ad', 'Kc Kd', 'Qc Qd'],
      board: '2c 7h 9s Jd 3c',
    })
    s = play(s, raise(200), raise(1000), call)
    expect(s.complete).toBe(true)
    expect(s.result!.stacks).toEqual({ p0: 600, p1: 1600, p2: 0 })
  })

  it('returns an uncalled portion of a bet', () => {
    let s = hand([1000, 400], { holes: ['As Ad', 'Kc Kd'], board: '2c 7h 9s Jd 3c' })
    s = play(s, raise(1000), call)
    expect(s.result!.stacks).toEqual({ p0: 1400, p1: 0 })
  })

  it('keeps chips constant and tracks the pot', () => {
    let s = hand([1000, 1000, 1000])
    s = play(s, raise(300))
    expect(potSize(s)).toBe(450)
    s = play(s, fold, fold)
    const total = Object.values(s.result!.stacks).reduce((a, b) => a + b, 0)
    expect(total).toBe(3000)
  })

  it('refuses actions after the hand is complete', () => {
    const s = play(hand([1000, 1000]), fold)
    expect(() => applyAction(s, check)).toThrow(/complete/)
  })

  it('is deterministic for a seed', () => {
    const a = hand([1000, 1000, 1000], { seed: 99 })
    const b = hand([1000, 1000, 1000], { seed: 99 })
    expect(a.seats.map((s) => s.hole)).toEqual(b.seats.map((s) => s.hole))
  })
})

describe('edge cases from the rules review', () => {
  it('heads-up: SB already covering a short all-in BB is not asked to act', () => {
    const s = hand([1000, 30], { holes: ['7c 2d', 'As Ad'], board: '3c 8h 9s Jd Kc' })
    expect(s.complete).toBe(true)
    // Main pot 60 to the BB's aces; the SB's uncovered 20 comes back.
    expect(s.result!.stacks).toEqual({ p0: 970, p1: 60 })
  })

  it('3 players: after UTG folds, SB covering a short all-in BB is not asked to act', () => {
    let s = hand([1000, 1000, 30])
    s = play(s, fold)
    expect(s.complete).toBe(true)
  })

  it('heads-up: short all-in SB runs out and the BB gets its uncalled chips back', () => {
    const s = hand([30, 1000], { holes: ['As Ad', 'Kc Kd'], board: '2c 7h 9s Jd 3c' })
    expect(s.complete).toBe(true)
    expect(s.result!.stacks).toEqual({ p0: 60, p1: 970 })
  })

  it('a postflop all-in bet below the big blind: next min raise adds a full BB; earlier checkers may only call', () => {
    // Button p0, SB p1, BB p2 (150 chips). Everyone limps; flop order p1, p2, p0.
    let s = hand([1000, 1000, 150])
    s = play(s, call, call, check)
    expect(s.street).toBe('flop')
    s = play(s, check, raise(50)) // p1 checks, p2 bets all-in 50
    expect(s.toAct).toBe(0)
    expect(legalActions(s).minRaiseTo).toBe(150) // p0 has not acted: may raise to 50 + 100
    s = play(s, call)
    expect(s.toAct).toBe(1)
    expect(legalActions(s)).toMatchObject({ callAmount: 50, minRaiseTo: null }) // p1 checked earlier
  })

  it('the big blind may raise after an incomplete all-in raise (it has not acted yet)', () => {
    // Button p0, SB p1, BB p2, UTG p3 with 150 shoves (a 50 raise, less than a full 100).
    let s = hand([5000, 5000, 5000, 150])
    s = play(s, raise(150), call, call)
    expect(s.toAct).toBe(2)
    expect(legalActions(s).minRaiseTo).toBe(250)
  })

  it('several short all-ins that add up to a full raise reopen betting (TDA)', () => {
    // p3 raises to 300 (+200). p0 shoves 360, p1 shoves 520: p3 now faces 220 >= 200.
    let s = hand([360, 520, 5000, 5000])
    s = play(s, raise(300), raise(360), raise(520), call)
    expect(s.toAct).toBe(3)
    expect(legalActions(s)).toMatchObject({ callAmount: 220, minRaiseTo: 720 })
  })

  it('throws on an unknown action type instead of skipping the turn', () => {
    const s = hand([1000, 1000, 1000])
    expect(() => applyAction(s, { type: 'allin' } as unknown as Action)).toThrow(/unknown action type/)
  })

  it('validates blinds, deck override and player count', () => {
    const seats = [
      { id: 'a', stack: 1000 },
      { id: 'b', stack: 1000 },
    ]
    const base = { seats, buttonIndex: 0, smallBlind: 50, bigBlind: 100, seed: 1 }
    expect(() => createHand({ ...base, smallBlind: 12.5 })).toThrow(/invalid blinds/)
    const badDeck = arrangeDeck(0, [c('As Ad'), c('Kc Kd')]).map((x, i) => (i === 51 ? ('Xx' as Card) : x))
    expect(() => createHand({ ...base, deck: badDeck })).toThrow(/valid cards/)
    const eleven = Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, stack: 1000 }))
    expect(() => createHand({ ...base, seats: eleven })).toThrow(/at most 10/)
  })
})
