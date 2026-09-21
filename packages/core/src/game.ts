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
import type { EventSink, GameEvent } from './events'
import type { EventStore } from './store'

export interface TournamentGameOptions {
  gameId: string
  /** Players in seat order. */
  players: Player[]
  tournament: TournamentConfig
  store: EventStore
  decisionTimeoutMs: number
  paceMs?: number
  /**
   * Spending cap (USD). Checked before every decision: once reached, the current hand finishes as
   * check-or-fold with no further paid calls and the game ends. Overspend is at most one decision
   * (plus the unrecorded cost of any timed-out calls, which providers may still bill).
   */
  budgetUsd: number
  /**
   * Extra config recorded (and hashed) with the game, e.g. the line-up spec. It can't override the
   * fields the game actually runs with (tournament, players, timeouts, budget).
   */
  meta?: Record<string, unknown>
  /** Checked between hands: aborting lets the hand in progress finish, then ends the game as interrupted. */
  signal?: AbortSignal
  /**
   * Called with every event right after it is stored (e.g. to push to spectators). A listener that
   * throws is reported to `onListenerError` and never stops the game.
   */
  onEvent?: (event: GameEvent) => void
  onListenerError?: (error: unknown) => void
  timeoutGraceMs?: number
  maxConsecutiveFallbacks?: number
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
  const stored = opts.store.sink(opts.gameId)
  const sink: EventSink = {
    append(body) {
      const event = stored.append(body)
      try {
        opts.onEvent?.(event)
      } catch (e) {
        opts.onListenerError?.(e)
      }
      return event
    },
  }
  const overBudget = () => opts.store.gameCost(opts.gameId) >= opts.budgetUsd
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
      if (overBudget()) {
        t = endTournament(t, 'budget_cap')
        break
      }
      const result = await playHand({
        config: nextHandConfig(t),
        players,
        sink,
        decisionTimeoutMs: opts.decisionTimeoutMs,
        stopSpending: overBudget,
        ...(opts.timeoutGraceMs !== undefined ? { timeoutGraceMs: opts.timeoutGraceMs } : {}),
        ...(opts.maxConsecutiveFallbacks !== undefined ? { maxConsecutiveFallbacks: opts.maxConsecutiveFallbacks } : {}),
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
