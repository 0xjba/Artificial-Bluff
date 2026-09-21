import type { Pot } from './types'

export interface Contribution {
  id: string
  amount: number
  folded: boolean
}

/**
 * Splits contributions into a main pot and side pots.
 * Each distinct commitment level of a non-folded player closes a pot; folded chips
 * fall into whichever levels they reach. Chips above the highest live level are
 * added to the last pot (only its eligible players can win them).
 * `eligible` keeps the order of `contributions`: pass seats starting left of the button
 * so any winners picked from it are already in odd-chip order for `splitPot`.
 */
export function buildPots(contributions: readonly Contribution[]): Pot[] {
  const live = contributions.filter((c) => !c.folded)
  if (live.length === 0) throw new Error('buildPots: nobody left in the hand')
  const levels = [...new Set(live.map((c) => c.amount))].sort((a, b) => a - b)
  const pots: Pot[] = []
  let previous = 0
  for (const level of levels) {
    let amount = 0
    for (const c of contributions) amount += Math.max(0, Math.min(c.amount, level) - previous)
    const eligible = live.filter((c) => c.amount >= level).map((c) => c.id)
    if (amount > 0) pots.push({ amount, eligible })
    previous = level
  }
  let above = 0
  for (const c of contributions) above += Math.max(0, c.amount - previous)
  if (above > 0) {
    const last = pots[pots.length - 1]
    if (last) last.amount += above
    else pots.push({ amount: above, eligible: live.map((c) => c.id) })
  }
  return pots
}

/**
 * Splits `amount` between `winners` (already ordered from the first seat left of the
 * button). Odd chips go one each to the earliest winners in that order.
 */
export function splitPot(amount: number, winners: readonly string[]): Record<string, number> {
  const base = Math.floor(amount / winners.length)
  let odd = amount - base * winners.length
  const shares: Record<string, number> = {}
  for (const w of winners) {
    shares[w] = base + (odd > 0 ? 1 : 0)
    if (odd > 0) odd--
  }
  return shares
}
