import type { Card, EndReason, HandCategory, OptionId, Position, Street } from '@ab/engine'
import type { PlayerKind } from '@ab/players'
import type { FallbackKind, GameEvent, GameKind } from './events'

/** One seat as a spectator sees it. */
export interface SeatView {
  playerId: string
  kind: PlayerKind
  model: string
  /** Position in the current hand; null when not dealt in (eliminated). */
  position: Position | null
  stack: number
  /** Chips put in on the current street. */
  bet: number
  /** Chips put in this hand. */
  committed: number
  status: 'active' | 'folded' | 'all_in' | 'out'
  /** Hole cards this hand (spectators see everyone's); null when not dealt in. */
  hole: Card[] | null
  lastAction: { street: Street; optionId: OptionId; label: string } | null
  lastLatencyMs: number | null
  /** Running totals for the game. */
  costUsd: number
  decisions: number
  fallbacks: number
}

/** The most recent decision, for the on-screen lower third. */
export interface DecisionView {
  handId: string | null
  playerId: string
  street: Street
  optionId: OptionId
  label: string
  winProbability: number | null
  confidence: number | null
  optionProbabilities: Partial<Record<OptionId, number>> | null
  reasoning: string | null
  latencyMs: number
  costUsd: number
  fallback: boolean
  fallbackKind: FallbackKind | null
  fallbackReason: string | null
}

export interface HandView {
  handId: string | null
  buttonIndex: number
  smallBlind: number
  bigBlind: number
  board: Card[]
  /** Every chip committed this hand (all streets). */
  pot: number
  street: Street
  /** Whose turn it is, and the options they were offered. */
  toAct: string | null
  options: Array<{ id: OptionId; label: string }> | null
  showdown: Record<string, { category: HandCategory; label: string }> | null
  awards: Array<{ amount: number; winners: string[]; shares: Record<string, number> }>
  ended: boolean
}

export interface TableView {
  gameId: string | null
  kind: GameKind | null
  status: 'waiting' | 'running' | 'ended'
  /** Seats in the order the game announced them. */
  seats: SeatView[]
  hand: HandView | null
  handsPlayed: number
  lastDecision: DecisionView | null
  result: { reason: EndReason; winner: string | null; stacks: Record<string, number> } | null
  /**
   * Each live player's true chance of winning the main pot from here (all hole cards known), set by the
   * server with `withEquity` whenever the board or the live players change; null until computed.
   */
  equity: Record<string, number> | null
  /** True when `equity` is a sampled estimate (early streets) rather than exact. */
  equityEstimated: boolean
  /** seq of the last event applied (0 before any). */
  lastSeq: number
}

export function emptyView(): TableView {
  return { gameId: null, kind: null, status: 'waiting', seats: [], hand: null, handsPlayed: 0, lastDecision: null, result: null, equity: null, equityEstimated: false, lastSeq: 0 }
}

/**
 * Folds one event into the view and returns the new view (the input is not modified). Pure and fast,
 * so the server (snapshots) and the browser (live updates) build identical views from the same events.
 */
export function applyEvent(prev: TableView, e: GameEvent): TableView {
  const v: TableView = {
    ...prev,
    seats: prev.seats.map((s) => ({ ...s })),
    hand: prev.hand ? { ...prev.hand, board: [...prev.hand.board], awards: [...prev.hand.awards] } : null,
    lastSeq: e.seq,
  }
  const seat = (id: string) => {
    const s = v.seats.find((x) => x.playerId === id)
    if (!s) throw new Error(`view: event for unknown player ${id}`)
    return s
  }

  switch (e.type) {
    case 'game_started':
      return {
        ...emptyView(),
        gameId: e.gameId,
        kind: e.kind,
        status: 'running',
        lastSeq: e.seq,
        seats: e.players.map((p) => ({
          playerId: p.id,
          kind: p.kind,
          model: p.model,
          position: null,
          stack: 0,
          bet: 0,
          committed: 0,
          status: 'active',
          hole: null,
          lastAction: null,
          lastLatencyMs: null,
          costUsd: 0,
          decisions: 0,
          fallbacks: 0,
        })),
      }
    case 'hand_started': {
      const dealt = new Map(e.seats.map((s) => [s.playerId, s]))
      for (const s of v.seats) {
        const d = dealt.get(s.playerId)
        s.bet = 0
        s.committed = 0
        s.lastAction = null
        if (d) {
          s.position = d.position
          s.stack = d.stack
          s.status = 'active'
          s.hole = null
        } else {
          s.position = null
          s.status = 'out'
          s.hole = null
        }
      }
      for (const p of e.posts) {
        const s = seat(p.playerId)
        s.stack -= p.amount
        s.bet += p.amount
        s.committed += p.amount
        if (s.stack === 0) s.status = 'all_in'
      }
      v.hand = {
        handId: e.handId,
        buttonIndex: e.buttonIndex,
        smallBlind: e.smallBlind,
        bigBlind: e.bigBlind,
        board: [],
        pot: e.posts.reduce((sum, p) => sum + p.amount, 0),
        street: 'preflop',
        toAct: null,
        options: null,
        showdown: null,
        awards: [],
        ended: false,
      }
      v.equity = null
      v.equityEstimated = false
      return v
    }
    case 'cards_dealt':
      for (const [id, cards] of Object.entries(e.holes)) seat(id).hole = [...cards]
      return v
    case 'turn_started':
      if (v.hand) {
        v.hand.toAct = e.playerId
        v.hand.options = e.options.map((o) => ({ ...o }))
      }
      return v
    case 'decision': {
      const s = seat(e.playerId)
      s.stack -= e.chipsIn
      s.bet += e.chipsIn
      s.committed += e.chipsIn
      if (e.action.type === 'fold') s.status = 'folded'
      else if (s.stack === 0) s.status = 'all_in'
      s.lastAction = { street: e.street, optionId: e.optionId, label: e.label }
      s.lastLatencyMs = e.latencyMs
      s.costUsd += e.costUsd
      s.decisions++
      if (e.fallback) s.fallbacks++
      if (v.hand) {
        v.hand.pot += e.chipsIn
        v.hand.toAct = null
        v.hand.options = null
      }
      v.lastDecision = {
        handId: e.handId,
        playerId: e.playerId,
        street: e.street,
        optionId: e.optionId,
        label: e.label,
        winProbability: e.winProbability,
        confidence: e.confidence,
        optionProbabilities: e.optionProbabilities ? { ...e.optionProbabilities } : null,
        reasoning: e.reasoning,
        latencyMs: e.latencyMs,
        costUsd: e.costUsd,
        fallback: e.fallback,
        fallbackKind: e.fallbackKind,
        fallbackReason: e.fallbackReason,
      }
      return v
    }
    case 'street_dealt':
      if (v.hand) {
        v.hand.board = [...e.board]
        v.hand.street = e.street
      }
      for (const s of v.seats) s.bet = 0
      return v
    case 'showdown':
      if (v.hand) v.hand.showdown = Object.fromEntries(Object.entries(e.hands).map(([id, h]) => [id, { category: h.category, label: h.label }]))
      return v
    case 'pot_awarded':
      if (v.hand) v.hand.awards.push({ amount: e.amount, winners: [...e.winners], shares: { ...e.shares } })
      return v
    case 'hand_ended':
      for (const [id, stack] of Object.entries(e.stacks)) seat(id).stack = stack
      for (const s of v.seats) s.bet = 0
      if (v.hand) {
        v.hand.ended = true
        v.hand.toAct = null
        v.hand.options = null
      }
      v.handsPlayed++
      return v
    case 'game_ended':
      for (const [id, stack] of Object.entries(e.stacks)) seat(id).stack = stack
      v.status = 'ended'
      v.result = { reason: e.reason, winner: e.winner, stacks: { ...e.stacks } }
      return v
    default:
      return v
  }
}

/** Folds a whole event list, from an empty view. */
export function buildView(events: readonly GameEvent[]): TableView {
  return events.reduce(applyEvent, emptyView())
}

/** The view with the true-equity annotation set (see TableView.equity). */
export function withEquity(view: TableView, equity: Record<string, number> | null, estimated = false): TableView {
  return { ...view, equity: equity ? { ...equity } : null, equityEstimated: equity !== null && estimated }
}
