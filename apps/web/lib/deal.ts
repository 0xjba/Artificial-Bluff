import type { HandView } from '@ab/core/view'

/** Time between two hole cards leaving the deck, as a dealer goes round the table. */
export const DEAL_STEP_MS = 60
/** Time between the three flop cards turning over. */
export const BOARD_STAGGER_MS = 110

/**
 * When a hole card arrives: one card to each seat in turn, starting left of the button, then the
 * second round, the way a dealer pitches them.
 */
export function holeDelay(hand: Pick<HandView, 'seatOrder' | 'buttonIndex'> | null, playerId: string, cardIndex: number): number {
  if (!hand) return 0
  const n = hand.seatOrder.length
  const at = hand.seatOrder.indexOf(playerId)
  if (at < 0) return 0
  const turn = (at - hand.buttonIndex - 1 + n) % n
  return (cardIndex * n + turn) * DEAL_STEP_MS
}

/** The flop turns over left to right; the turn and the river arrive alone. */
export const boardDelay = (index: number): number => (index < 3 ? index * BOARD_STAGGER_MS : 0)

/** Whether the player took any pot, once the hand is over. */
export function wonHand(hand: Pick<HandView, 'ended' | 'awards'> | null, playerId: string): boolean {
  return Boolean(hand?.ended && hand.awards.some((a) => a.winners.includes(playerId)))
}
