import { mainPotSharesBySubset, type Card } from '@ab/engine'
import type { DecisionRecord, HandRecord } from './hands'

/** A decision with its outcome C and its per-action score. */
export interface ScoredDecision extends DecisionRecord {
  /**
   * Calibration outcome C: the player's expected share of the main pot at the moment of the decision,
   * against the players still in the hand, by exact enumeration of the remaining board given every
   * dealt hole card (folded hands' cards are dead). Later actions and board luck don't count.
   */
  expectedShare: number
  /**
   * Per-action outcome: 1 if the action was right, else 0. Folds and calls are scored by all-in equity
   * (outcome C) against the pot odds toCall / (winnablePot + toCall): a fold was right below them, a
   * call at or above them. Checks and raises have no such rule; they count as right if the player's
   * stack did not shrink from just before the action to the end of the hand, so later streets feed
   * into their score. Only ever compare this within one action type.
   */
  actionGood: 0 | 1
}

/**
 * Memo of main-pot shares, keyed by deal (every hole card, in canonical order), board and live
 * subset. Duplicate rotations deal the same cards, so they share entries.
 */
export type ShareCache = Map<string, number[]>

interface Canonical {
  /** Seat ids in canonical (card) order. */
  ids: string[]
  holes: Card[][]
  dealKey: string
}

function canonical(hand: HandRecord): Canonical {
  const players = hand.seats.map((s) => {
    const hole = hand.holes[s.playerId]
    if (!hole) throw new Error(`hand ${hand.handId}: no hole cards for ${s.playerId}`)
    return { id: s.playerId, hole, cards: hole.join('') }
  })
  // Same cards in different seats (duplicate rotations) give the same order and key.
  players.sort((a, b) => (a.cards < b.cards ? -1 : a.cards > b.cards ? 1 : 0))
  return { ids: players.map((p) => p.id), holes: players.map((p) => p.hole), dealKey: players.map((p) => p.cards).join('|') }
}

/** Indices (canonical order, ascending) of the decision's live players, and the cache key for them. */
function subsetOf(c: Canonical, d: DecisionRecord): { subset: number[]; key: string } {
  const subset = d.live.map((id) => c.ids.indexOf(id)).sort((a, b) => a - b)
  return { subset, key: `${c.dealKey}/${d.board.join('')}#${subset.join(',')}` }
}

/** Per-action outcome (see ScoredDecision.actionGood). */
export function actionGood(d: DecisionRecord, share: number): 0 | 1 {
  const potOdds = d.toCall / (d.winnablePot + d.toCall)
  if (d.actionType === 'fold') return share < potOdds ? 1 : 0
  if (d.actionType === 'call') return share >= potOdds ? 1 : 0
  return d.stackChange >= 0 ? 1 : 0
}

/**
 * Every decision of every hand, with outcome C and the per-action score. All live-player subsets
 * needed for one deal and board are enumerated in a single pass.
 */
export function scoreDecisions(hands: readonly HandRecord[], cache: ShareCache = new Map()): ScoredDecision[] {
  const canon = new Map(hands.map((h) => [h, canonical(h)]))
  const pending = new Map<string, { holes: Card[][]; board: Card[]; subsets: Map<string, number[]> }>()
  for (const hand of hands) {
    const c = canon.get(hand)!
    for (const d of hand.decisions) {
      const { subset, key } = subsetOf(c, d)
      if (cache.has(key)) continue
      const base = `${c.dealKey}/${d.board.join('')}`
      let job = pending.get(base)
      if (!job) pending.set(base, (job = { holes: c.holes, board: d.board, subsets: new Map() }))
      job.subsets.set(key, subset)
    }
  }
  for (const job of pending.values()) {
    const keys = [...job.subsets.keys()]
    const results = mainPotSharesBySubset(job.holes, job.board, [...job.subsets.values()])
    keys.forEach((k, i) => cache.set(k, results[i]!))
  }
  const out: ScoredDecision[] = []
  for (const hand of hands) {
    const c = canon.get(hand)!
    for (const d of hand.decisions) {
      const { subset, key } = subsetOf(c, d)
      const share = cache.get(key)![subset.indexOf(c.ids.indexOf(d.playerId))]!
      out.push({ ...d, expectedShare: share, actionGood: actionGood(d, share) })
    }
  }
  return out
}
