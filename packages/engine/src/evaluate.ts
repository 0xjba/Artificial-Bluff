/// <reference path="./phe.d.ts" />
import { evaluateCards, handRank, rankDescription } from 'phe'
import { isCard, type Card } from './cards'

export type HandCategory =
  | 'straight_flush'
  | 'four_of_a_kind'
  | 'full_house'
  | 'flush'
  | 'straight'
  | 'three_of_a_kind'
  | 'two_pair'
  | 'one_pair'
  | 'high_card'

const CATEGORIES: HandCategory[] = [
  'straight_flush',
  'four_of_a_kind',
  'full_house',
  'flush',
  'straight',
  'three_of_a_kind',
  'two_pair',
  'one_pair',
  'high_card',
]

export interface HandValue {
  /** Lower is better: 1 is a royal flush, 7462 is the worst high card. */
  value: number
  category: HandCategory
  /** Human label, e.g. "Full House". */
  label: string
}

/** Evaluates the best 5-card hand from 5, 6 or 7 cards. */
export function evaluateHand(cards: readonly Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`evaluateHand needs 5-7 cards, got ${cards.length}`)
  }
  // phe does no validation and silently mis-evaluates bad strings, so check every card.
  const bad = cards.find((c) => !isCard(c))
  if (bad !== undefined) throw new Error(`evaluateHand got a malformed card: ${bad}`)
  if (new Set(cards).size !== cards.length) {
    throw new Error(`evaluateHand got duplicate cards: ${cards.join(' ')}`)
  }
  const value = evaluateCards([...cards])
  const idx = handRank(value)
  return { value, category: CATEGORIES[idx]!, label: rankDescription[idx]! }
}

/** Negative if a beats b, positive if b beats a, 0 on a tie. */
export function compareHands(a: HandValue, b: HandValue): number {
  return a.value - b.value
}
