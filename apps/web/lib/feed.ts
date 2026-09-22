import { applyEvent, emptyView, withEquity, type TableView } from '@ab/core/view'
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
}

export const initialFeed = (): FeedState => ({ channel: null, view: emptyView(), log: [], decisionEquity: null })

/**
 * Folds one feed message into the client state. A snapshot replaces everything (new programme or
 * reconnect); events and equity for another channel are ignored (they raced a programme change).
 */
export function reduceFeed(state: FeedState, message: FeedMessage, name: (id: string) => string): FeedState {
  if (message.type === 'snapshot') return { channel: message.channel, view: message.view, log: [], decisionEquity: null }
  if (!state.channel || message.channelId !== state.channel.id) return state
  if (message.type === 'equity') return { ...state, view: withEquity(state.view, message.equity, message.estimated) }
  const e = message.event
  const decisionEquity = e.type === 'decision' ? (state.view.equity?.[e.playerId] ?? null) : state.decisionEquity
  const line = logLine(e, name)
  return {
    ...state,
    view: applyEvent(state.view, e),
    log: line ? [...state.log, line].slice(-LOG_LIMIT) : state.log,
    decisionEquity: e.type === 'hand_started' ? null : decisionEquity,
  }
}
