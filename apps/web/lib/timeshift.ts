import type { GameEvent } from '@ab/core/view'
import type { Channel } from '@ab/server'
import { initialFeed, reduceFeed, type EquitySource, type FeedState } from './feed'

export { mergeHistory } from './feed'

/**
 * The screen as it was after the first `n` events of the programme. The true chances are not in the
 * history (the server sends them for the present only), so `equityFor` works them out again.
 */
export function feedAt(channel: Channel, events: GameEvent[], n: number, name: (id: string) => string, equityFor?: EquitySource): FeedState {
  let state = reduceFeed(initialFeed(), { type: 'snapshot', channel, view: initialFeed().view }, name)
  // History is dropped at each step: the past screen doesn't need it, and copying it would be quadratic.
  for (const e of events.slice(0, n)) state = reduceFeed({ ...state, history: [] }, { type: 'event', channelId: channel.id, event: e }, name, equityFor)
  return { ...state, history: [] }
}

/** Positions (events applied) at which each hand has just started. */
export function handStarts(events: GameEvent[]): number[] {
  const starts: number[] = []
  events.forEach((e, i) => {
    if (e.type === 'hand_started') starts.push(i + 1)
  })
  return starts
}

/**
 * Where "previous hand" goes from `pos`: the start of this hand, or of the one before when this hand has
 * barely begun (at most its first decision shown; the past plays on, so a start is never held for long).
 */
export function prevHand(events: GameEvent[], pos: number): number {
  const starts = handStarts(events).filter((p) => p < pos)
  const current = starts.at(-1)
  if (current === undefined) return handStarts(events)[0] ?? 0
  const decisions = events.slice(current, pos).filter((e) => e.type === 'decision').length
  return decisions <= 1 ? (starts.at(-2) ?? current) : current
}

/** Where "next hand" goes from `pos`, or null when there is none yet (then it's live). */
export function nextHand(events: GameEvent[], pos: number): number | null {
  return handStarts(events).find((p) => p > pos) ?? null
}

/** The hand number (1-based) showing at `pos`, or 0 before the first hand. */
export function handAt(events: GameEvent[], pos: number): number {
  return handStarts(events).filter((p) => p <= pos).length
}

/** Whether the history is the whole programme from its start with nothing missing (so the past can be rebuilt). */
export function seekable(events: GameEvent[]): boolean {
  const first = events[0]
  const last = events.at(-1)
  return first?.type === 'game_started' && last !== undefined && last.seq - first.seq + 1 === events.length
}
