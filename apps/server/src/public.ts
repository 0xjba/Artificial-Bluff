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
   * The full config (seeds included) once the game is over, so anyone can check it against the hash
   * and replay the decks. Withheld while the game runs: seeds reveal every card still to come.
   */
  config: unknown | null
}

export function publicGame(row: GameRow): PublicGame {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    createdAt: row.createdAt,
    endedAt: row.endedAt,
    configHash: row.configHash,
    config: row.status === 'running' ? null : row.config,
  }
}

/**
 * An event as spectators may see it. Hole cards are public (spectators see every hand; the players are
 * programs that never read the feed). While a game runs, a study hand's deck seed is removed: the other
 * rotations of its group deal the same deck.
 */
export function publicEvent(e: GameEvent, running: boolean): GameEvent {
  if (running && e.type === 'hand_started' && e.duplicate) {
    const { seed: _seed, ...duplicate } = e.duplicate
    return { ...e, duplicate: { ...duplicate, seed: 0 } }
  }
  return e
}
