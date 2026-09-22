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

  // Joining a live game: fetch its events so far, so viewers can seek back to before they arrived.
  const channelId = state.channel?.id
  const liveGame = state.channel?.mode === 'live' ? state.channel.gameId : null
  useEffect(() => {
    if (!channelId || !liveGame) return
    let stopped = false
    void loadHistory(liveGame).then((events) => {
      if (!stopped && events) dispatch({ type: 'history', channelId, events })
    })
    return () => {
      stopped = true
    }
  }, [channelId, liveGame])
  return { ...state, connection }
}

/** A game's events so far (paged by the API), or null if they can't be read now. */
async function loadHistory(gameId: string): Promise<GameEvent[] | null> {
  const events: GameEvent[] = []
  let after = 0
  try {
    for (;;) {
      const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/events?after=${after}`, { cache: 'no-store' })
      if (!res.ok) return null
      const page = (await res.json()) as { events: GameEvent[]; next: number | null }
      events.push(...page.events)
      if (page.next === null) return events
      after = page.next
    }
  } catch {
    return null // no seeking back before joining; the feed's own events still can be
  }
}
