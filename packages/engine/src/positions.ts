export type Position = 'BTN' | 'SB' | 'BB' | 'UTG' | 'UTG+1' | 'UTG+2' | 'MP' | 'LJ' | 'HJ' | 'CO'

/** Names for the seats between the big blind and the button, by how many there are. */
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
  if (playerCount < 2) throw new Error('need at least 2 players')
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
  const middle = MIDDLE[playerCount - 3]
  if (!middle) throw new Error(`positions supports up to ${MIDDLE.length + 2} players`)
  middle.forEach((name, k) => {
    out[(bb + 1 + k) % playerCount] = name
  })
  return out
}
