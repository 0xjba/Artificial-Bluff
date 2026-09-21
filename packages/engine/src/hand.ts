import { fullDeck, type Card } from './cards'
import { evaluateHand, type HandValue } from './evaluate'
import { buildPots, splitPot } from './pots'
import { shuffle } from './rng'
import type {
  Action,
  ActionKind,
  HandConfig,
  HandResult,
  HandState,
  LegalActions,
  PotAward,
  SeatState,
  Street,
} from './types'

const NEXT_STREET: Record<Street, Street | null> = { preflop: 'flop', flop: 'turn', turn: 'river', river: null }
const BOARD_CARDS: Record<Street, number> = { preflop: 0, flop: 3, turn: 1, river: 1 }

/** Seat indices clockwise starting at the seat after `from`. */
function clockwiseFrom(from: number, n: number): number[] {
  return Array.from({ length: n }, (_, k) => (from + 1 + k) % n)
}

function draw(state: HandState, count: number): Card[] {
  if (state.deck.length < count) throw new Error('deck exhausted')
  return state.deck.splice(0, count)
}

function commit(seat: SeatState, amount: number): number {
  const paid = Math.min(amount, seat.stack)
  seat.stack -= paid
  seat.streetCommitted += paid
  seat.handCommitted += paid
  if (seat.stack === 0) seat.allIn = true
  return paid
}

function record(state: HandState, seatIndex: number, kind: ActionKind, amount: number): number {
  const seat = state.seats[seatIndex]!
  const seq = state.seq++
  state.history.push({
    seq,
    street: state.street,
    seatIndex,
    playerId: seat.id,
    kind,
    amount,
    to: seat.streetCommitted,
    allIn: seat.allIn,
  })
  return seq
}

function liveSeats(state: HandState): SeatState[] {
  return state.seats.filter((s) => !s.folded)
}

function actors(state: HandState): SeatState[] {
  return state.seats.filter((s) => !s.folded && !s.allIn)
}

function needsAction(state: HandState, seat: SeatState): boolean {
  if (seat.folded || seat.allIn) return false
  return seat.lastActionSeq === null || seat.streetCommitted < state.currentBet
}

/** Next seat clockwise after `from` that must act, or null when the street is over. */
function nextToAct(state: HandState, from: number): number | null {
  const canAct = actors(state)
  if (canAct.length === 0) return null
  if (canAct.length === 1 && canAct[0]!.streetCommitted >= state.currentBet) return null
  for (const i of clockwiseFrom(from, state.seats.length)) {
    if (needsAction(state, state.seats[i]!)) return i
  }
  return null
}

function checkedDeck(deck: Card[]): Card[] {
  if (deck.length !== 52 || new Set(deck).size !== 52) throw new Error('deck override must be 52 unique cards')
  return [...deck]
}

export function createHand(config: HandConfig): HandState {
  const n = config.seats.length
  if (n < 2) throw new Error('a hand needs at least 2 players')
  if (new Set(config.seats.map((s) => s.id)).size !== n) throw new Error('player ids must be unique')
  if (config.seats.some((s) => !Number.isInteger(s.stack) || s.stack <= 0)) {
    throw new Error('every stack must be a positive integer')
  }
  if (config.buttonIndex < 0 || config.buttonIndex >= n) throw new Error('buttonIndex out of range')
  if (config.smallBlind <= 0 || config.bigBlind < config.smallBlind) throw new Error('invalid blinds')

  const state: HandState = {
    config: structuredClone(config),
    seats: config.seats.map((s, i) => ({
      id: s.id,
      seatIndex: i,
      stack: s.stack,
      startingStack: s.stack,
      streetCommitted: 0,
      handCommitted: 0,
      folded: false,
      allIn: false,
      hole: [],
      lastActionSeq: null,
    })),
    deck: config.deck ? checkedDeck(config.deck) : shuffle(fullDeck(), config.seed),
    board: [],
    street: 'preflop',
    complete: false,
    currentBet: 0,
    lastRaiseSize: config.bigBlind,
    lastFullRaiseSeq: -1,
    toAct: null,
    seq: 0,
    history: [],
    result: null,
  }

  // Deal two rounds of one card each, starting left of the button.
  const order = clockwiseFrom(config.buttonIndex, n)
  for (let round = 0; round < 2; round++) {
    for (const i of order) state.seats[i]!.hole.push(...draw(state, 1))
  }

  // Heads-up: the button posts the small blind. Otherwise the two seats after the button.
  const sbIndex = n === 2 ? config.buttonIndex : order[0]!
  const bbIndex = n === 2 ? order[0]! : order[1]!
  record(state, sbIndex, 'post_sb', commit(state.seats[sbIndex]!, config.smallBlind))
  record(state, bbIndex, 'post_bb', commit(state.seats[bbIndex]!, config.bigBlind))
  state.currentBet = config.bigBlind
  state.lastRaiseSize = config.bigBlind

  state.toAct = nextToAct(state, bbIndex)
  if (state.toAct === null) finishStreet(state)
  return state
}

export function legalActions(state: HandState): LegalActions {
  const none: LegalActions = { canFold: false, canCheck: false, callAmount: 0, minRaiseTo: null, maxRaiseTo: null }
  if (state.complete || state.toAct === null) return none
  const seat = state.seats[state.toAct]!
  const toCall = state.currentBet - seat.streetCommitted
  const maxTo = seat.streetCommitted + seat.stack
  const opponentsWhoCanAct = actors(state).filter((s) => s.seatIndex !== seat.seatIndex).length
  const reopened = seat.lastActionSeq === null || state.lastFullRaiseSeq > seat.lastActionSeq
  const canRaise = reopened && opponentsWhoCanAct > 0 && maxTo > state.currentBet
  const minTo = state.currentBet + state.lastRaiseSize
  return {
    canFold: toCall > 0,
    canCheck: toCall === 0,
    callAmount: toCall > 0 ? Math.min(toCall, seat.stack) : 0,
    minRaiseTo: canRaise ? Math.min(minTo, maxTo) : null,
    maxRaiseTo: canRaise ? maxTo : null,
  }
}

/** Returns a new state with `action` applied by the seat to act. Throws on an illegal action. */
export function applyAction(prev: HandState, action: Action): HandState {
  if (prev.complete || prev.toAct === null) throw new Error('no action expected: hand is complete')
  const state = structuredClone(prev)
  const legal = legalActions(state)
  const i = state.toAct!
  const seat = state.seats[i]!

  switch (action.type) {
    case 'fold': {
      if (!legal.canFold) throw new Error('illegal fold: nothing to call, check instead')
      seat.folded = true
      seat.lastActionSeq = record(state, i, 'fold', 0)
      break
    }
    case 'check': {
      if (!legal.canCheck) throw new Error('illegal check: facing a bet')
      seat.lastActionSeq = record(state, i, 'check', 0)
      break
    }
    case 'call': {
      if (legal.callAmount === 0) throw new Error('illegal call: nothing to call')
      seat.lastActionSeq = record(state, i, 'call', commit(seat, legal.callAmount))
      break
    }
    case 'raise': {
      if (legal.minRaiseTo === null || legal.maxRaiseTo === null) throw new Error('illegal raise: raising not allowed')
      const to = action.to
      if (!Number.isInteger(to)) throw new Error('raise amount must be an integer')
      if (to > legal.maxRaiseTo) throw new Error(`illegal raise: ${to} exceeds all-in ${legal.maxRaiseTo}`)
      if (to < legal.minRaiseTo) throw new Error(`illegal raise: ${to} below minimum ${legal.minRaiseTo}`)
      const increment = to - state.currentBet
      const kind: ActionKind = state.currentBet === 0 ? 'bet' : 'raise'
      const seq = record(state, i, kind, commit(seat, to - seat.streetCommitted))
      seat.lastActionSeq = seq
      if (increment >= state.lastRaiseSize) {
        // A full raise reopens the betting for everyone.
        state.lastRaiseSize = increment
        state.lastFullRaiseSeq = seq
      }
      state.currentBet = to
      break
    }
  }

  if (liveSeats(state).length === 1) {
    finishHand(state)
    return state
  }
  state.toAct = nextToAct(state, i)
  if (state.toAct === null) finishStreet(state)
  return state
}

function startStreet(state: HandState, street: Street): void {
  state.street = street
  draw(state, 1) // burn
  state.board.push(...draw(state, BOARD_CARDS[street]))
  state.currentBet = 0
  state.lastRaiseSize = state.config.bigBlind
  state.lastFullRaiseSeq = -1
  for (const s of state.seats) {
    s.streetCommitted = 0
    s.lastActionSeq = null
  }
}

/** Called when betting on the current street is over. Deals on, runs out, or goes to showdown. */
function finishStreet(state: HandState): void {
  for (;;) {
    const next = NEXT_STREET[state.street]
    if (next === null) {
      finishHand(state)
      return
    }
    startStreet(state, next)
    state.toAct = nextToAct(state, state.config.buttonIndex)
    if (state.toAct !== null) return
    // Nobody can bet (everyone else all-in): keep dealing until the river.
  }
}

function finishHand(state: HandState): void {
  state.complete = true
  state.toAct = null
  const n = state.seats.length
  const live = liveSeats(state)
  const showdown = live.length > 1
  const hands: Record<string, HandValue> = {}
  if (showdown) {
    for (const s of live) hands[s.id] = evaluateHand([...s.hole, ...state.board])
  }

  // Winners are listed starting from the first seat left of the button (odd-chip order).
  const order = clockwiseFrom(state.config.buttonIndex, n).map((i) => state.seats[i]!.id)
  const pots = buildPots(state.seats.map((s) => ({ id: s.id, amount: s.handCommitted, folded: s.folded })))
  const awards: PotAward[] = pots.map((pot) => {
    let winners: string[]
    if (pot.eligible.length === 1) {
      winners = [...pot.eligible]
    } else {
      const best = Math.min(...pot.eligible.map((id) => hands[id]!.value))
      winners = order.filter((id) => pot.eligible.includes(id) && hands[id]!.value === best)
    }
    return { ...pot, winners, shares: splitPot(pot.amount, winners) }
  })

  for (const award of awards) {
    for (const [id, chips] of Object.entries(award.shares)) {
      state.seats.find((s) => s.id === id)!.stack += chips
    }
  }

  const stacks: Record<string, number> = {}
  const net: Record<string, number> = {}
  for (const s of state.seats) {
    stacks[s.id] = s.stack
    net[s.id] = s.stack - s.startingStack
  }
  const result: HandResult = { showdown, awards, hands, board: [...state.board], stacks, net }
  state.result = result
}

/** Total chips in the middle, including the current street's bets. */
export function potSize(state: HandState): number {
  return state.seats.reduce((sum, s) => sum + s.handCommitted, 0)
}
