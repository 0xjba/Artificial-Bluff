import { applyEvent, emptyView, withEquity, type GameEvent, type TableView } from '@ab/core/view'
import type { Channel, FeedMessage } from '@ab/server'
import { logLine, type LogLine } from './log'

/** Most log lines kept on screen. */
export const LOG_LIMIT = 60

export interface FeedState {
  channel: Channel | null
  view: TableView
  log: LogLine[]
  /** The last decider's true chance of winning just before they acted (to set against what they said). */
  decisionEquity: number | null
  /** Every event of the programme seen so far, oldest first (to seek back through a live game). */
  history: GameEvent[]
  /** Snapshots received (a reconnect sends one for the same channel): the history is reloaded after each. */
  snapshots: number
}

/** The programme's earlier events, fetched after joining (merged with those the feed has brought since). */
export type HistoryMessage = { type: 'history'; channelId: string; events: GameEvent[] }

export const initialFeed = (): FeedState => ({ channel: null, view: emptyView(), log: [], decisionEquity: null, history: [], snapshots: 0 })

/**
 * Folds one feed message into the client state. A snapshot replaces everything (new programme or
 * reconnect); events and equity for another channel are ignored (they raced a programme change).
 */
export function reduceFeed(state: FeedState, message: FeedMessage | HistoryMessage, name: (id: string) => string): FeedState {
  if (message.type === 'snapshot') return { channel: message.channel, view: message.view, log: [], decisionEquity: null, history: [], snapshots: state.snapshots + 1 }
  if (!state.channel || message.channelId !== state.channel.id) return state
  if (message.type === 'history') {
    const history = mergeHistory(message.events, state.history)
    // With the whole game in hand, the log can show what happened before joining too.
    return { ...state, history, log: history[0]?.type === 'game_started' ? logFor(history, name) : state.log }
  }
  if (message.type === 'equity') return { ...state, view: withEquity(state.view, message.equity, message.estimated) }
  const e = message.event
  const decisionEquity = e.type === 'decision' ? (state.view.equity?.[e.playerId] ?? null) : state.decisionEquity
  const line = logLine(e, name, state.view)
  return {
    ...state,
    view: applyEvent(state.view, e),
    log: line ? [...state.log, line].slice(-LOG_LIMIT) : state.log,
    decisionEquity: e.type === 'hand_started' ? null : decisionEquity,
    history: [...state.history, e],
  }
}

/** Events of both lists, each seq once, in order (a fetched backlog merged with what the feed brought). */
export function mergeHistory(a: GameEvent[], b: GameEvent[]): GameEvent[] {
  const bySeq = new Map<number, GameEvent>()
  for (const e of a) bySeq.set(e.seq, e)
  for (const e of b) bySeq.set(e.seq, e)
  return [...bySeq.values()].sort((x, y) => x.seq - y.seq)
}

/** The log lines of a stream of events that starts at its game_started (the last LOG_LIMIT). */
export function logFor(events: GameEvent[], name: (id: string) => string): LogLine[] {
  const lines: LogLine[] = []
  let view = emptyView()
  for (const e of events) {
    const line = logLine(e, name, view)
    if (line) lines.push(line)
    view = applyEvent(view, e)
  }
  return lines.slice(-LOG_LIMIT)
}
