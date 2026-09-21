import { rankValue, suitOf, type Card } from '../src/cards'

/**
 * Deliberately simple, slow reference evaluator used only to cross-check the engine.
 * Returns a comparable tuple: [category, ...tiebreak ranks], higher is better.
 * Categories: 8 straight flush, 7 quads, 6 full house, 5 flush, 4 straight,
 * 3 trips, 2 two pair, 1 pair, 0 high card.
 */
export function referenceScore5(cards: Card[]): number[] {
  const ranks = cards.map(rankValue).sort((a, b) => b - a)
  const flush = new Set(cards.map(suitOf)).size === 1
  const unique = [...new Set(ranks)]
  let straightHigh = -1
  if (unique.length === 5) {
    if (unique[0]! - unique[4]! === 4) straightHigh = unique[0]!
    else if (unique.join(',') === '12,3,2,1,0') straightHigh = 3 // wheel, five-high
  }
  const counts = new Map<number, number>()
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1)
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const shape = groups.map((g) => g[1]).join('')
  const byGroup = groups.map((g) => g[0])
  if (flush && straightHigh >= 0) return [8, straightHigh]
  if (shape === '41') return [7, ...byGroup]
  if (shape === '32') return [6, ...byGroup]
  if (flush) return [5, ...ranks]
  if (straightHigh >= 0) return [4, straightHigh]
  if (shape === '311') return [3, ...byGroup]
  if (shape === '221') return [2, ...byGroup]
  if (shape === '2111') return [1, ...byGroup]
  return [0, ...ranks]
}

export function compareScores(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export function referenceScore7(cards: Card[]): number[] {
  let best: number[] = [-1]
  for (let a = 0; a < cards.length; a++)
    for (let b = a + 1; b < cards.length; b++) {
      const five = cards.filter((_, i) => i !== a && i !== b)
      const s = referenceScore5(five)
      if (compareScores(s, best) > 0) best = s
    }
  return best
}
