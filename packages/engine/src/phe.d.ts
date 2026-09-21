declare module 'phe' {
  /** 1 = royal flush (best) … 7462 = 7-high (worst). */
  export function evaluateCards(cards: string[]): number
  /** 0 = straight flush … 8 = high card. */
  export function handRank(value: number): number
  export const rankDescription: string[]
}
