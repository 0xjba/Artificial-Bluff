import {
  createTournament,
  endTournament,
  nextHandConfig,
  recordHand,
  type MenuConfig,
  type TournamentConfig,
  type TournamentState,
} from '@ab/engine'
import type { Player } from '@ab/players'
import { playHand } from './runner'
import type { EventStore } from './store'

export interface TournamentGameOptions {
  gameId: string
  /** Players in seat order. */
  players: Player[]
  tournament: TournamentConfig
  store: EventStore
  decisionTimeoutMs: number
  paceMs?: number
  /** Stop after the hand in which total spend reaches this (USD). */
  budgetUsd: number
  /**
   * Extra config recorded (and hashed) with the game, e.g. the line-up spec. It can't override the
   * fields the game actually runs with (tournament, players, timeouts, budget).
   */
  meta?: Record<string, unknown>
  /** Checked between hands: aborting lets the hand in progress finish, then ends the game as interrupted. */
  signal?: AbortSignal
  menu?: Partial<MenuConfig>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * Runs a live tournament to completion, recording everything in the store. If anything throws
 * mid-game, the game is ended as 'interrupted' (with a game_ended event) before the error is
 * rethrown, so it never stays 'running' with nothing driving it.
 */
export async function runTournamentGame(opts: TournamentGameOptions): Promise<TournamentState> {
  const players = new Map(opts.players.map((p) => [p.id, p]))
  // Validate before writing anything: a bad config must not leave a game row behind.
  let t = createTournament(
    opts.players.map((p) => p.id),
    opts.tournament,
  )
  const game = opts.store.createGame(opts.gameId, 'live', {
    ...opts.meta,
    tournament: opts.tournament,
    players: opts.players.map((p) => ({ id: p.id, kind: p.kind, model: p.model })),
    decisionTimeoutMs: opts.decisionTimeoutMs,
    paceMs: opts.paceMs ?? 0,
    budgetUsd: opts.budgetUsd,
  })
  const sink = opts.store.sink(opts.gameId)
  const finish = (state: TournamentState) =>
    sink.append({
      type: 'game_ended',
      reason: state.endReason!,
      winner: state.winner,
      stacks: Object.fromEntries(state.players.map((p) => [p.id, p.stack])),
      eliminated: [...state.eliminated],
      handsPlayed: state.handNumber,
    })

  try {
    sink.append({
      type: 'game_started',
      kind: 'live',
      configHash: game.configHash,
      players: opts.players.map((p) => ({ id: p.id, kind: p.kind, model: p.model })),
    })
    while (!t.complete) {
      if (opts.signal?.aborted) {
        t = endTournament(t, 'interrupted')
        break
      }
      if (opts.store.gameCost(opts.gameId) >= opts.budgetUsd) {
        t = endTournament(t, 'budget_cap')
        break
      }
      const result = await playHand({
        config: nextHandConfig(t),
        players,
        sink,
        decisionTimeoutMs: opts.decisionTimeoutMs,
        ...(opts.paceMs !== undefined ? { paceMs: opts.paceMs } : {}),
        ...(opts.menu ? { menu: opts.menu } : {}),
        ...(opts.now ? { now: opts.now } : {}),
        ...(opts.sleep ? { sleep: opts.sleep } : {}),
      })
      t = recordHand(t, result)
    }
  } catch (error) {
    const stopped = t.complete ? t : endTournament(t, 'interrupted')
    try {
      finish(stopped)
    } finally {
      opts.store.setStatus(opts.gameId, 'interrupted')
    }
    throw error
  }

  finish(t)
  opts.store.setStatus(opts.gameId, t.endReason === 'interrupted' ? 'interrupted' : 'ended')
  return t
}
