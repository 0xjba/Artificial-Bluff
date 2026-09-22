import type { TableView } from '@ab/core'
import { deriveSeed, mainPotSharesBySubset, remainingBoards, sampleMainPotShares, type Card } from '@ab/engine'

/** Above this many hand evaluations, the on-screen equity is sampled instead of enumerated. */
export const EXACT_EVALUATION_LIMIT = 200_000
/** Boards sampled for an estimate (standard error under 0.4 percentage points). */
export const EQUITY_SAMPLES = 20_000

export interface TableEquity {
  equity: Record<string, number>
  /** True for a sampled estimate. */
  estimated: boolean
}

/**
 * Each live player's true chance of winning the main pot from here, given every dealt hole card and
 * the board (the same quantity as the study's outcome C). Exact when that is cheap (from the flop on);
 * otherwise (preflop) a reproducible 20,000-board estimate, so the event loop is never blocked for long. Null when there is no hand in progress or fewer than two players are still in.
 */
export function tableEquity(view: TableView): TableEquity | null {
  const hand = view.hand
  if (!hand || hand.ended || ![0, 3, 4, 5].includes(hand.board.length)) return null
  const dealt = view.seats.filter((s) => s.hole !== null && s.status !== 'out')
  if (dealt.length < 2) return null
  const live = dealt.map((s, i) => ({ s, i })).filter(({ s }) => s.status !== 'folded')
  if (live.length < 2) return null
  const holes = dealt.map((s) => s.hole as Card[])
  const subset = live.map(({ i }) => i)
  const evaluations = remainingBoards(dealt.length * 2 + hand.board.length, hand.board.length) * subset.length
  const estimated = evaluations > EXACT_EVALUATION_LIMIT
  const shares = estimated
    ? sampleMainPotShares(holes, hand.board, subset, EQUITY_SAMPLES, deriveSeed('equity', view.gameId ?? '', hand.handId ?? '', hand.board.join(''), subset.join(',')))
    : mainPotSharesBySubset(holes, hand.board, [subset])[0]!
  return { equity: Object.fromEntries(live.map(({ s }, j) => [s.playerId, shares[j]!])), estimated }
}
/** Cache key of what equity depends on: the hand, the board and who is still in. */
export function equityKey(view: TableView): string | null {
  const hand = view.hand
  if (!hand || hand.ended) return null
  const live = view.seats.filter((s) => s.hole !== null && s.status !== 'out' && s.status !== 'folded').map((s) => s.playerId)
  return `${view.gameId}/${hand.handId}/${hand.board.join('')}/${live.join(',')}`
}
