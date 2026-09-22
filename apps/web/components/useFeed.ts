'use client'
import { characterFor } from '@ab/mascot'
import type { FeedMessage } from '@ab/server'
import { useEffect, useReducer, useState } from 'react'
import type { GameEvent } from '@ab/core/view'
import { initialFeed, reduceFeed, type FeedState, type HistoryMessage } from '../lib/feed'

const name = (id: string) => characterFor(id).name

export type Connection = 'connecting' | 'open' | 'lost'

/** Reconnect delays after the browser gives up on a feed (an error status closes an EventSource for good). */
export const RECONNECT_MS = [3000, 6000, 12_000, 30_000]

/**
 * Follows the server's spectator feed (Server-Sent Events). The browser retries dropped connections by
 * itself, but not after an error status (e.g. the live server was down and the proxy answered 500):
 * then this opens a new connection, backing off from 3 s to 30 s.
 */
export function useFeed(url: string): FeedState & { connection: Connection } {
  const [state, dispatch] = useReducer((s: FeedState, m: FeedMessage | HistoryMessage) => reduceFeed(s, m, name), undefined, initialFeed)
  const [connection, setConnection] = useState<Connection>('connecting')
  useEffect(() => {
    let source: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    let stopped = false
    const open = () => {
      source = new EventSource(url)
      source.onopen = () => {
        attempt = 0
        setConnection('open')
      }
      source.onerror = () => {
        setConnection('lost')
        if (source?.readyState === EventSource.CLOSED && !stopped) {
          source.close()
          retry = setTimeout(open, RECONNECT_MS[Math.min(attempt++, RECONNECT_MS.length - 1)])
        }
      }
      source.onmessage = (m) => {
        try {
          dispatch(JSON.parse(m.data) as FeedMessage)
        } catch {
          // ignore a malformed message; the next snapshot resets the view anyway
        }
      }
    }
    open()
    return () => {
      stopped = true
      if (retry) clearTimeout(retry)
      source?.close()
    }
  }, [url])

  // Joining a programme (or reconnecting, which resets the history): fetch the game's events so far,
  // so viewers can seek back to before they arrived.
  const channelId = state.channel?.id
  // Live or replay: both play a game whose earlier events can be fetched, so the seek bar can reach
  // back past the point where this viewer joined.
  const gameId = state.channel?.gameId ?? null
  const joinedAt = state.joinedAt
  const snapshots = state.snapshots
  useEffect(() => {
    if (!channelId || !gameId) return
    const abort = new AbortController()
    void loadHistory(url, gameId, abort.signal).then((events) => {
      // Never past where the programme has reached: a replay's later events are its ending.
      if (!abort.signal.aborted && events) dispatch({ type: 'history', channelId, events: events.filter((e) => e.seq <= joinedAt) })
    })
    return () => abort.abort()
  }, [url, channelId, gameId, snapshots, joinedAt])
  return { ...state, connection }
}

/** A game's events so far (paged by the API, from the feed's server), or null if they can't be read now. */
async function loadHistory(feedUrl: string, gameId: string, signal: AbortSignal): Promise<GameEvent[] | null> {
  const events: GameEvent[] = []
  let after = 0
  try {
    const base = new URL(feedUrl, window.location.href)
    for (;;) {
      const page = new URL(`/api/games/${encodeURIComponent(gameId)}/events?after=${after}`, base)
      const res = await fetch(page, { cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) })
      if (!res.ok) return null
      const body = (await res.json()) as { events: GameEvent[]; next: number | null }
      events.push(...body.events)
      if (body.next === null) return events
      after = body.next
    }
  } catch {
    return null // no seeking back before joining; the feed's own events still can be
  }
}
