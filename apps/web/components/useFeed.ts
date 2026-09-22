'use client'
import { characterFor } from '@ab/mascot'
import type { FeedMessage } from '@ab/server'
import { useEffect, useReducer, useState } from 'react'
import { initialFeed, reduceFeed, type FeedState } from '../lib/feed'

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
  const [state, dispatch] = useReducer((s: FeedState, m: FeedMessage) => reduceFeed(s, m, name), undefined, initialFeed)
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
  return { ...state, connection }
}
