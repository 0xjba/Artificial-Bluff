declare module 'phe' {
  /** 1 = royal flush (best) … 7462 = 7-high (worst). */
  export function evaluateCards(cards: string[]): number
  /** Same scale as evaluateCards, from 5-7 card codes (0-51, see cardCode). */
  export function evaluateCardCodes(codes: number[]): number
  /** Card code 0-51 from a rank ('2'…'A') and a suit ('s', 'h', 'd', 'c'). */
  export function cardCode(rank: string, suit: string): number
  /** 0 = straight flush … 8 = high card. */
  export function handRank(value: number): number
  export const rankDescription: string[]
}
