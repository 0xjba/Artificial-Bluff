'use client'
import { characterFor } from '@ab/mascot'
import type { FeedMessage } from '@ab/server'
import { useEffect, useReducer, useState } from 'react'
import { initialFeed, reduceFeed, type FeedState } from '../lib/feed'

const name = (id: string) => characterFor(id).name

/** Follows the server's spectator feed (Server-Sent Events; the browser reconnects by itself). */
export function useFeed(url: string): FeedState & { connected: boolean } {
  const [state, dispatch] = useReducer((s: FeedState, m: FeedMessage) => reduceFeed(s, m, name), undefined, initialFeed)
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    const source = new EventSource(url)
    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)
    source.onmessage = (m) => {
      try {
        dispatch(JSON.parse(m.data) as FeedMessage)
      } catch {
        // ignore a malformed message; the next snapshot resets the view anyway
      }
    }
    return () => source.close()
  }, [url])
  return { ...state, connected }
}
