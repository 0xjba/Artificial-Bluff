import { applyEvent, emptyView, withEquity, type GameEvent, type TableView } from '@ab/core'
import { equityKey, tableEquity } from './equity'

/** What spectators are watching. */
export interface Channel {
  /** Changes whenever the programme changes (a new live game, the next replay). */
  id: string
  mode: 'idle' | 'live' | 'replay'
  /** Shown on screen, e.g. "LIVE" or "REPLAY · study main-2026-09, hand 12:3". */
  title: string
  gameId: string | null
}

/** Messages on the spectator feed. A client resets its view on every snapshot. */
export type FeedMessage =
  | { type: 'snapshot'; channel: Channel; view: TableView }
  | { type: 'event'; channelId: string; event: GameEvent }
  | { type: 'equity'; channelId: string; handId: string | null; equity: Record<string, number> | null; estimated: boolean }

export type Subscriber = (message: FeedMessage) => void

/**
 * The one programme everyone watches: the current channel, its table view (built from the events
 * published so far) and the subscribers. New subscribers get a snapshot, then every message.
 */
export class Hub {
  private channel: Channel = { id: 'idle-0', mode: 'idle', title: 'Waiting for the next game', gameId: null }
  private view: TableView = emptyView()
  private readonly subscribers = new Set<Subscriber>()
  private lastEquityKey: string | null = null
  private counter = 0

  /** Starts a new programme: resets the view and sends everyone a snapshot. */
  begin(channel: Omit<Channel, 'id'>): Channel {
    this.channel = { ...channel, id: `${channel.mode}-${++this.counter}` }
    this.view = emptyView()
    this.lastEquityKey = null
    this.broadcast(this.snapshot())
    return this.channel
  }

  /** Back to idle (e.g. between a live game and the next replay). */
  idle(title = 'Waiting for the next game'): Channel {
    return this.begin({ mode: 'idle', title, gameId: null })
  }

  /** Adds an event to the current programme; recomputes true equity when the board or live players change. */
  publish(event: GameEvent): void {
    this.view = applyEvent(this.view, event)
    this.broadcast({ type: 'event', channelId: this.channel.id, event })
    const key = equityKey(this.view)
    if (key !== this.lastEquityKey) {
      this.lastEquityKey = key
      const result = key === null ? null : tableEquity(this.view)
      this.view = withEquity(this.view, result?.equity ?? null, result?.estimated ?? false)
      if (key !== null) {
        this.broadcast({ type: 'equity', channelId: this.channel.id, handId: this.view.hand?.handId ?? null, equity: this.view.equity, estimated: this.view.equityEstimated })
      }
    }
  }

  snapshot(): FeedMessage {
    return { type: 'snapshot', channel: { ...this.channel }, view: this.view }
  }

  current(): { channel: Channel; view: TableView } {
    return { channel: { ...this.channel }, view: this.view }
  }

  /** Adds a subscriber and sends it the snapshot; returns the unsubscribe function. */
  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    this.safeSend(fn, this.snapshot())
    return () => this.subscribers.delete(fn)
  }

  get clientCount(): number {
    return this.subscribers.size
  }

  private broadcast(message: FeedMessage): void {
    for (const fn of this.subscribers) this.safeSend(fn, message)
  }

  /** A subscriber that throws (a broken connection) is dropped; it never stops the game. */
  private safeSend(fn: Subscriber, message: FeedMessage): void {
    try {
      fn(message)
    } catch {
      this.subscribers.delete(fn)
    }
  }
}
