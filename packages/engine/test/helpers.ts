import { fullDeck, type Card } from '../src/cards'

/**
 * Builds a 52-card deck that deals the given hole cards and board.
 * `holes[i]` are seat i's two cards. Dealing starts left of the button,
 * one card per round, then burn + flop, burn + turn, burn + river.
 */
export function arrangeDeck(buttonIndex: number, holes: Card[][], board: Card[] = []): Card[] {
  const n = holes.length
  const order = Array.from({ length: n }, (_, k) => (buttonIndex + 1 + k) % n)
  const used = new Set<Card>([...holes.flat(), ...board])
  const spare = fullDeck().filter((c) => !used.has(c))
  const take = () => {
    const c = spare.shift()
    if (!c) throw new Error('arrangeDeck ran out of spare cards')
    return c
  }
  const top: Card[] = []
  for (let round = 0; round < 2; round++) for (const i of order) top.push(holes[i]![round]!)
  const boardOrSpare = (k: number) => board[k] ?? take()
  top.push(take(), boardOrSpare(0), boardOrSpare(1), boardOrSpare(2))
  top.push(take(), boardOrSpare(3))
  top.push(take(), boardOrSpare(4))
  return [...top, ...spare]
}
