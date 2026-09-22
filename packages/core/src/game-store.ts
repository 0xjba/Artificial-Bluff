import type { EventSink, GameKind } from './events'

export type GameStatus = 'running' | 'ended' | 'interrupted'

/**
 * What a tournament game needs from its store. The SQLite EventStore (server, studies) and the
 * MemoryStore (a table running in a browser) both provide it.
 */
export interface GameStore {
  /** Records a new running game; `configHash` is written into its game_started event. */
  createGame(id: string, kind: GameKind, config: unknown): { configHash: string }
  sink(gameId: string): EventSink
  /** Total spent by all players in the game (USD). */
  gameCost(gameId: string): number
  setStatus(id: string, status: GameStatus): void
}
