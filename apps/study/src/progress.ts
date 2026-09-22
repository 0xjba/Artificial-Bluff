import type { EventStore, GameEvent, StudyEndReason } from '@ab/core'

/** The auto reason playHand records once the spending cap stops play mid-hand. */
export const BUDGET_CAP_REASON = 'auto: budget cap reached'

export const handKeyOf = (groupIndex: number, rotation: number) => `${groupIndex}:${rotation}`

/** What the event log says about a study so far. */
export interface StudyProgress {
  /** handKey -> highest attempt number started. */
  attempts: Map<string, number>
  /** handKey -> chips won/lost per player, for the valid (completed, never budget-capped) attempt. */
  valid: Map<string, Record<string, number>>
  /** handKey -> hand id of that valid attempt (the hand the analysis uses). */
  validHandIds: Map<string, string>
  handsPlayed: number
  lastEnd: StudyEndReason | null
  /** analysedGroups of the last study_ended: the groups its published results use. */
  analysedGroups: number | null
  /** The last logged stopping-rule check: resume continues from its boundary. */
  lastCheckpoint: { groups: number; stop: boolean } | null
}

export function emptyProgress(): StudyProgress {
  return { attempts: new Map(), valid: new Map(), validHandIds: new Map(), handsPlayed: 0, lastEnd: null, analysedGroups: null, lastCheckpoint: null }
}

/**
 * Rebuilds progress from a study's events (for resume). A hand attempt counts only if it reached
 * hand_ended and no decision in it was auto-played because the budget cap was hit.
 */
export function readProgress(events: readonly GameEvent[]): StudyProgress {
  const p = emptyProgress()
  const byHandId = new Map<string, { key: string; capped: boolean }>()
  for (const e of events) {
    if (e.type === 'hand_started' && e.duplicate && e.handId) {
      const key = handKeyOf(e.duplicate.groupIndex, e.duplicate.rotation)
      byHandId.set(e.handId, { key, capped: false })
      p.attempts.set(key, Math.max(p.attempts.get(key) ?? 0, e.duplicate.attempt))
    } else if (e.type === 'decision' && e.handId && e.fallbackReason === BUDGET_CAP_REASON) {
      const h = byHandId.get(e.handId)
      if (h) h.capped = true
    } else if (e.type === 'hand_ended' && e.handId) {
      p.handsPlayed++
      const h = byHandId.get(e.handId)
      if (h && !h.capped && !p.valid.has(h.key)) {
        p.valid.set(h.key, e.net)
        p.validHandIds.set(h.key, e.handId)
      }
    } else if (e.type === 'study_checkpoint') {
      p.lastCheckpoint = { groups: e.groups, stop: e.stop }
    } else if (e.type === 'study_ended') {
      p.lastEnd = e.reason
      p.analysedGroups = e.analysedGroups
    }
  }
  return p
}

export function readStoreProgress(store: EventStore, gameId: string): StudyProgress {
  return readProgress(store.events(gameId))
}

/** Number of groups complete in order from group 0 (every rotation has a valid hand). */
export function completedPrefix(p: StudyProgress, players: number, maxGroups: number): number {
  let g = 0
  while (g < maxGroups) {
    for (let r = 0; r < players; r++) if (!p.valid.has(handKeyOf(g, r))) return g
    g++
  }
  return g
}
