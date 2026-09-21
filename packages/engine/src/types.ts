import type { Card } from './cards'
import type { HandValue } from './evaluate'

export type Street = 'preflop' | 'flop' | 'turn' | 'river'

/** `raise.to` is the player's total commitment for this street after the action (bets are raises from 0). */
export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number }

export interface SeatInput {
  id: string
  stack: number
}

export interface HandConfig {
  /** Players in clockwise seat order. Every stack must be > 0. */
  seats: SeatInput[]
  /** Index into `seats` of the button. */
  buttonIndex: number
  smallBlind: number
  bigBlind: number
  seed: number
  /** Test/replay override: the full 52-card deck, top card first. Ignores `seed` when set. */
  deck?: Card[]
}

export interface SeatState {
  id: string
  /** Index into `HandState.seats`. */
  seatIndex: number
  stack: number
  startingStack: number
  /** Chips put in on the current street. */
  streetCommitted: number
  /** Chips put in over the whole hand. */
  handCommitted: number
  folded: boolean
  allIn: boolean
  hole: Card[]
  /** `seq` of this seat's last voluntary action on the current street, or null. */
  lastActionSeq: number | null
}

export type ActionKind = 'post_sb' | 'post_bb' | 'fold' | 'check' | 'call' | 'bet' | 'raise'

export interface ActionRecord {
  seq: number
  street: Street
  seatIndex: number
  playerId: string
  kind: ActionKind
  /** Chips moved from stack to pot by this action. */
  amount: number
  /** The seat's street commitment after the action. */
  to: number
  allIn: boolean
}

export interface Pot {
  amount: number
  /** Player ids that can win this pot. */
  eligible: string[]
}

export interface PotAward extends Pot {
  winners: string[]
  /** Chips each winner receives from this pot. */
  shares: Record<string, number>
}

export interface HandResult {
  /** True if two or more players reached showdown. */
  showdown: boolean
  awards: PotAward[]
  /** Hand values of players who reached showdown. */
  hands: Record<string, HandValue>
  board: Card[]
  stacks: Record<string, number>
  /** Chips won (positive) or lost (negative) this hand. */
  net: Record<string, number>
}

export interface HandState {
  config: HandConfig
  seats: SeatState[]
  /** Undealt cards, next card first. */
  deck: Card[]
  board: Card[]
  street: Street
  complete: boolean
  /** Highest street commitment. */
  currentBet: number
  /** Size of the last full bet or raise on this street (the minimum raise increment). */
  lastRaiseSize: number
  /** `seq` of the last full bet or raise on this street; -1 when none. */
  lastFullRaiseSeq: number
  /** Index into `seats` of the player to act, or null when nobody is to act. */
  toAct: number | null
  seq: number
  history: ActionRecord[]
  result: HandResult | null
}

export interface LegalActions {
  canFold: boolean
  canCheck: boolean
  /** Chips needed to call (capped at the stack), 0 when calling is not possible. */
  callAmount: number
  /** Minimum legal raise-to, or null if the seat may not raise. May equal maxRaiseTo (all-in only). */
  minRaiseTo: number | null
  /** Maximum raise-to (all-in), or null if the seat may not raise. */
  maxRaiseTo: number | null
}
