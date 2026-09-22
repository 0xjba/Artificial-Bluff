/// <reference path="./phe.d.ts" />
import { cardCode, evaluateCardCodes } from 'phe'
import { fullDeck, isCard, type Card } from './cards'

/**
 * Each player's expected share of the main pot if nobody folds from here: exact enumeration of every
 * remaining board, splitting ties equally. `holes[i]` are player i's two hole cards; `board` has 0, 3,
 * 4 or 5 cards. The main pot is contested by every player still in the hand, so this is each player's
 * share of it at showdown, averaged over the boards still possible. Shares sum to 1.
 *
 * Cost: preflop with 5 players is ~850,000 boards (about 0.2 s); later streets are instant.
 */
export function mainPotShares(holes: readonly (readonly Card[])[], board: readonly Card[]): number[] {
  return mainPotSharesBySubset(holes, board, [holes.map((_, i) => i)])[0]!
}

/**
 * mainPotShares for several subsets of the same players (e.g. who was still in the hand at each
 * decision of a deal) in one pass over the boards. `subsets[k]` lists indices into `holes` (at least
 * two each); result `[k][j]` is the share of player `subsets[k][j]`. Every player's hole cards are
 * dead, including those outside a subset (a folded hand's cards can't come on the board), so this is
 * the exact equity given every dealt card. Enumerating the boards once is what makes exact preflop
 * equity affordable for a whole study.
 */
export function mainPotSharesBySubset(
  holes: readonly (readonly Card[])[],
  board: readonly Card[],
  subsets: readonly (readonly number[])[],
): number[][] {
  if (holes.length < 2) throw new Error('mainPotShares needs at least two players')
  if (![0, 3, 4, 5].includes(board.length)) throw new Error(`mainPotShares: a board has 0, 3, 4 or 5 cards, got ${board.length}`)
  for (const h of holes) if (h.length !== 2) throw new Error('mainPotShares: every player needs two hole cards')
  const known = [...holes.flat(), ...board]
  const bad = known.find((c) => !isCard(c))
  if (bad !== undefined) throw new Error(`mainPotShares got a malformed card: ${bad}`)
  if (new Set(known).size !== known.length) throw new Error(`mainPotShares got duplicate cards: ${known.join(' ')}`)
  for (const sub of subsets) {
    if (sub.length < 2) throw new Error('mainPotShares: every subset needs at least two players')
    if (new Set(sub).size !== sub.length || sub.some((i) => !Number.isInteger(i) || i < 0 || i >= holes.length)) {
      throw new Error(`mainPotShares: bad subset ${sub.join(',')}`)
    }
  }

  const code = (c: Card) => cardCode(c[0]!, c[1]!)
  const holeCodes = holes.map((h) => h.map(code))
  const used = new Set(known)
  const rest = fullDeck().filter((c) => !used.has(c)).map(code)
  const missing = 5 - board.length
  const n = holes.length
  const needed = [...new Set(subsets.flat())]
  const shares = subsets.map((sub) => new Array<number>(sub.length).fill(0))
  const values = new Array<number>(n).fill(0)
  const cards = new Array<number>(7).fill(0)
  board.forEach((c, i) => (cards[i] = code(c)))
  let boards = 0

  const score = () => {
    boards++
    for (const p of needed) {
      cards[5] = holeCodes[p]![0]!
      cards[6] = holeCodes[p]![1]!
      values[p] = evaluateCardCodes(cards)
    }
    for (let k = 0; k < subsets.length; k++) {
      const sub = subsets[k]!
      let best = Infinity
      let tied = 0
      for (const p of sub) {
        const v = values[p]!
        if (v < best) {
          best = v
          tied = 1
        } else if (v === best) tied++
      }
      const out = shares[k]!
      for (let j = 0; j < sub.length; j++) if (values[sub[j]!] === best) out[j]! += 1 / tied
    }
  }
  // Choose the missing cards from the rest of the deck, in increasing index order.
  const pick = (from: number, slot: number) => {
    if (slot === 5) return score()
    for (let i = from; i <= rest.length - (5 - slot); i++) {
      cards[slot] = rest[i]!
      pick(i + 1, slot + 1)
    }
  }
  pick(0, 5 - missing)
  return shares.map((row) => row.map((s) => s / boards))
}
