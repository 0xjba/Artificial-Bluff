import { fullDeck, type Card } from '@ab/engine'

/** Deck that deals `holes` (seat order) and `board`, dealing from left of the button with burns. */
export function arrangeDeckForTests(buttonIndex: number, holes: string[][], board: string[]): Card[] {
  const n = holes.length
  const order = Array.from({ length: n }, (_, k) => (buttonIndex + 1 + k) % n)
  const used = new Set([...holes.flat(), ...board])
  const spare = fullDeck().filter((c) => !used.has(c))
  const top: string[] = []
  for (let round = 0; round < 2; round++) for (const i of order) top.push(holes[i]![round]!)
  top.push(spare.shift()!, board[0]!, board[1]!, board[2]!, spare.shift()!, board[3]!, spare.shift()!, board[4]!)
  return [...(top as Card[]), ...spare]
}
