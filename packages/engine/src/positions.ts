export type Position = 'BTN' | 'SB' | 'BB' | 'UTG' | 'UTG+1' | 'UTG+2' | 'MP' | 'LJ' | 'HJ' | 'CO'

export const MAX_POSITIONED_PLAYERS = 10

/**
 * Names for the seats between the big blind and the button, by how many there are.
 * Deliberate convention: seats fill in from the button side (CO, HJ, LJ) and the earliest seats
 * are UTG, UTG+1, UTG+2, so every seat has a distinct, unambiguous label at every table size
 * (6-max and 10-max match common solver naming; some sites say EP/MP for 7-9 handed).
 */
const MIDDLE: Position[][] = [
  [],
  ['UTG'],
  ['UTG', 'CO'],
  ['UTG', 'HJ', 'CO'],
  ['UTG', 'LJ', 'HJ', 'CO'],
  ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO'],
  ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO'],
  ['UTG', 'UTG+1', 'UTG+2', 'MP', 'LJ', 'HJ', 'CO'],
]

/** Seat indices of the blinds. Heads-up the button posts the small blind. */
export function blindSeats(playerCount: number, buttonIndex: number): { sb: number; bb: number } {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > MAX_POSITIONED_PLAYERS) {
    throw new Error(`positions support 2 to ${MAX_POSITIONED_PLAYERS} players`)
  }
  if (!Number.isInteger(buttonIndex) || buttonIndex < 0 || buttonIndex >= playerCount) {
    throw new Error('buttonIndex out of range')
  }
  if (playerCount === 2) return { sb: buttonIndex, bb: (buttonIndex + 1) % 2 }
  return { sb: (buttonIndex + 1) % playerCount, bb: (buttonIndex + 2) % playerCount }
}

/**
 * Position name for every seat index. Heads-up the button is labelled 'BTN' (it also posts
 * the small blind) and the other seat 'BB'.
 */
export function positions(playerCount: number, buttonIndex: number): Position[] {
  const out = new Array<Position>(playerCount)
  const { sb, bb } = blindSeats(playerCount, buttonIndex)
  out[buttonIndex] = 'BTN'
  if (playerCount === 2) {
    out[bb] = 'BB'
    return out
  }
  out[sb] = 'SB'
  out[bb] = 'BB'
  MIDDLE[playerCount - 3]!.forEach((name, k) => {
    out[(bb + 1 + k) % playerCount] = name
  })
  return out
}
