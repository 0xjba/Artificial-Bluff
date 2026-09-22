import type { GameEvent, GameRow } from '@ab/core'

/** What the public API says about a game. */
export interface PublicGame {
  id: string
  kind: GameRow['kind']
  status: GameRow['status']
  createdAt: number
  endedAt: number | null
  configHash: string
  /**
   * The full config (seeds included) once the game is over for good (see isOver), so anyone can check
   * it against the hash and replay the decks. Withheld until then: seeds reveal every card still to come.
   */
  config: unknown | null
}

/**
 * Whether a game is over for good, so its seeds can be published: an ended game, or an interrupted live
 * game (live games never resume). An interrupted study can be resumed, so its master seed stays secret.
 */
export function isOver(row: GameRow): boolean {
  return row.status === 'ended' || (row.kind === 'live' && row.status === 'interrupted')
}

export function publicGame(row: GameRow): PublicGame {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    createdAt: row.createdAt,
    endedAt: row.endedAt,
    configHash: row.configHash,
    config: isOver(row) ? row.config : null,
  }
}

/** Stands in for a withheld deck seed (real seeds are unsigned 32-bit integers). */
export const WITHHELD_SEED = -1

/**
 * An event as spectators may see it. Hole cards are public (spectators see every hand; the players are
 * programs that never read the feed). Until a game is over, a study hand's deck seed is withheld.
 */
export function publicEvent(e: GameEvent, over: boolean): GameEvent {
  if (!over && e.type === 'hand_started' && e.duplicate) return { ...e, duplicate: { ...e.duplicate, seed: WITHHELD_SEED } }
  return e
}
