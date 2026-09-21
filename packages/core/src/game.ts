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
  /** Extra config recorded (and hashed) with the game, e.g. the line-up spec. */
  meta?: Record<string, unknown>
  signal?: AbortSignal
  menu?: Partial<MenuConfig>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** Runs a live tournament to completion, recording everything in the store. */
export async function runTournamentGame(opts: TournamentGameOptions): Promise<TournamentState> {
  const players = new Map(opts.players.map((p) => [p.id, p]))
  const game = opts.store.createGame(opts.gameId, 'live', {
    tournament: opts.tournament,
    players: opts.players.map((p) => ({ id: p.id, kind: p.kind, model: p.model })),
    decisionTimeoutMs: opts.decisionTimeoutMs,
    paceMs: opts.paceMs ?? 0,
    budgetUsd: opts.budgetUsd,
    ...opts.meta,
  })
  const sink = opts.store.sink(opts.gameId)
  sink.append({
    type: 'game_started',
    kind: 'live',
    configHash: game.configHash,
    players: opts.players.map((p) => ({ id: p.id, kind: p.kind, model: p.model })),
  })

  let t = createTournament(
    opts.players.map((p) => p.id),
    opts.tournament,
  )
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

  sink.append({
    type: 'game_ended',
    reason: t.endReason!,
    winner: t.winner,
    stacks: Object.fromEntries(t.players.map((p) => [p.id, p.stack])),
    eliminated: [...t.eliminated],
    handsPlayed: t.handNumber,
  })
  opts.store.setStatus(opts.gameId, t.endReason === 'interrupted' ? 'interrupted' : 'ended')
  return t
}
