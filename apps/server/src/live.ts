import { runTournamentGame, type EventStore } from '@ab/core'
import { liveTurboConfig } from '@ab/engine'
import type { Player } from '@ab/players'
import { randomBytes } from 'node:crypto'
import type { Hub } from './hub'
import { publicEvent } from './public'

export interface LiveDeps {
  store: EventStore
  hub: Hub
  /** Fresh players for each game (players keep no state between games, but models may). */
  makePlayers: () => Player[] | Promise<Player[]>
  budgetUsd: number
  paceMs: number
  decisionTimeoutMs: number
  /** Recorded (and hashed) with each game, e.g. the line-up and whether it is a mock game. */
  meta?: Record<string, unknown>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  log?: (line: string) => void
}

export class LiveBusyError extends Error {
  constructor(readonly gameId: string) {
    super(`a live game is already running (${gameId})`)
  }
}

type Listener = (state: 'live' | 'idle', gameId: string) => void

/** Runs at most one live game at a time and puts its events on the hub. */
export class LiveController {
  private current: { gameId: string; abort: AbortController; done: Promise<void> } | null = null
  private readonly listeners = new Set<Listener>()

  constructor(private readonly deps: LiveDeps) {}

  get gameId(): string | null {
    return this.current?.gameId ?? null
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /**
   * Starts a live game (turbo tournament, per-game budget cap). The deck seed is random and secret:
   * game ids are public, so they must never be the seed. Returns once the game is running.
   */
  async start(): Promise<{ gameId: string }> {
    if (this.current) throw new LiveBusyError(this.current.gameId)
    const now = this.deps.now ?? Date.now
    const gameId = `live-${new Date(now()).toISOString().replace(/[:.]/g, '-')}`
    const abort = new AbortController()
    // Claim the table before any await, so two quick starts can't both run.
    const slot = { gameId, abort, done: Promise.resolve() }
    this.current = slot
    let players: Player[]
    try {
      players = await this.deps.makePlayers()
    } catch (e) {
      this.current = null
      throw e
    }
    this.deps.hub.begin({ mode: 'live', title: 'LIVE', gameId })
    this.emit('live', gameId)
    slot.done = runTournamentGame({
      gameId,
      players,
      tournament: liveTurboConfig(randomBytes(16).toString('hex')),
      store: this.deps.store,
      decisionTimeoutMs: this.deps.decisionTimeoutMs,
      paceMs: this.deps.paceMs,
      budgetUsd: this.deps.budgetUsd,
      ...(this.deps.meta ? { meta: this.deps.meta } : {}),
      signal: abort.signal,
      onEvent: (e) => this.deps.hub.publish(publicEvent(e, true)),
      onListenerError: (e) => this.deps.log?.(`feed error: ${String(e)}`),
      ...(this.deps.sleep ? { sleep: this.deps.sleep } : {}),
    })
      .then((t) => this.deps.log?.(`live game ${gameId} ended: ${t.endReason}, winner ${t.winner ?? 'none'}`))
      .catch((e) => this.deps.log?.(`live game ${gameId} failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        this.current = null
        this.emit('idle', gameId)
      })
    return { gameId }
  }

  /** Asks the running game to stop after the hand in progress. Returns its id, or null if none. */
  stop(): string | null {
    if (!this.current) return null
    this.current.abort.abort()
    return this.current.gameId
  }

  /** Resolves when no game is running. */
  async idle(): Promise<void> {
    while (this.current) await this.current.done
  }

  private emit(state: 'live' | 'idle', gameId: string): void {
    for (const fn of this.listeners) fn(state, gameId)
  }
}
