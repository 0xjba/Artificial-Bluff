export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const
export const SUITS = ['c', 'd', 'h', 's'] as const

export type Rank = (typeof RANKS)[number]
export type Suit = (typeof SUITS)[number]

/** A card as a two-character string, rank then suit: "As", "Td", "2c". */
export type Card = `${Rank}${Suit}`

export function fullDeck(): Card[] {
  const deck: Card[] = []
  for (const s of SUITS) for (const r of RANKS) deck.push(`${r}${s}`)
  return deck
}

export function rankOf(card: Card): Rank {
  return card[0] as Rank
}

export function suitOf(card: Card): Suit {
  return card[1] as Suit
}

/** 0 for a deuce up to 12 for an ace. */
export function rankValue(card: Card): number {
  return RANKS.indexOf(rankOf(card))
}

export function isCard(value: string): value is Card {
  return (
    value.length === 2 &&
    (RANKS as readonly string[]).includes(value[0]!) &&
    (SUITS as readonly string[]).includes(value[1]!)
  )
}
