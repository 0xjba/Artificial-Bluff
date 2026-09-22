import type { EventBody, EventSink, GameEvent, GameKind } from './events'
import type { GameStatus, GameStore } from './game-store'

interface MemoryGame {
  kind: GameKind
  status: GameStatus
  events: GameEvent[]
  cost: number
}

/**
 * A GameStore kept in memory, for a table that runs in the visitor's browser. Nothing is persisted
 * and configs are not hashed (a browser table is not pre-registered research), so its game_started
 * event carries the hash "in-memory".
 */
export class MemoryStore implements GameStore {
  readonly #games = new Map<string, MemoryGame>()

  createGame(id: string, kind: GameKind, _config?: unknown): { configHash: string } {
    if (this.#games.has(id)) throw new Error(`game ${id} exists`)
    this.#games.set(id, { kind, status: 'running', events: [], cost: 0 })
    return { configHash: 'in-memory' }
  }

  sink(gameId: string, now: () => number = Date.now): EventSink {
    const game = this.#game(gameId)
    return {
      append: (body: EventBody) => {
        const event = { ...body, gameId, seq: game.events.length + 1, ts: now() } as GameEvent
        game.events.push(event)
        if (event.type === 'decision') game.cost += event.costUsd
        return event
      },
    }
  }

  gameCost(gameId: string): number {
    return this.#game(gameId).cost
  }

  setStatus(id: string, status: GameStatus): void {
    this.#game(id).status = status
  }

  status(id: string): GameStatus {
    return this.#game(id).status
  }

  events(gameId: string): GameEvent[] {
    return [...this.#game(gameId).events]
  }

  #game(id: string): MemoryGame {
    const game = this.#games.get(id)
    if (!game) throw new Error(`no game ${id}`)
    return game
  }
}
