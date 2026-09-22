'use client'
import { characterFor } from '@ab/mascot'
import { useEffect, useRef, useState } from 'react'
import { reduceFeed, type FeedState } from '../lib/feed'
import { feedAt, handAt, handStarts, nextHand, prevHand } from '../lib/timeshift'
import { Broadcast } from './Broadcast'
import { replayPause } from './ReplayScreen'
import { useFeed } from './useFeed'

const name = (id: string) => characterFor(id).name

/** Watching the past of the live game: how many events are shown, that screen, and whether it plays on. */
interface Past {
  pos: number
  state: FeedState
  playing: boolean
}

/**
 * The home screen: whatever the server is showing (live game, replay, or the idle card). During a live
 * game viewers can seek back through it (a seek bar and hand steps); the past then plays on at replay
 * pace until it catches up, and the LIVE tag (dimmed meanwhile) jumps straight back.
 */
export function LiveScreen({ feedUrl }: { feedUrl: string }) {
  const feed = useFeed(feedUrl)
  const { channel, history } = feed
  const [past, setPast] = useState<Past | null>(null)
  const historyRef = useRef(history)
  historyRef.current = history

  // A new programme starts live.
  useEffect(() => setPast(null), [channel?.id])

  // Play the past on, one event at a time, back to live when it catches up.
  useEffect(() => {
    if (!past?.playing || !channel) return
    const shown = historyRef.current[past.pos - 1]
    const timer = setTimeout(
      () =>
        setPast((p) => {
          const next = p && historyRef.current[p.pos]
          if (!p || !next) return null
          return { ...p, pos: p.pos + 1, state: reduceFeed({ ...p.state, history: [] }, { type: 'event', channelId: channel.id, event: next }, name) }
        }),
      shown ? replayPause(shown) : 0,
    )
    return () => clearTimeout(timer)
  }, [past, channel])

  // Seeking needs the whole game from its start (the backlog may still be loading, or have failed).
  const canSeek = channel?.mode === 'live' && history[0]?.type === 'game_started'
  const seek = (pos: number | null) => {
    if (!channel || pos === null || pos >= history.length) return setPast(null)
    setPast((p) => ({ pos, state: feedAt(channel, history, pos, name), playing: p?.playing ?? true }))
  }
  const pos = past?.pos ?? history.length
  const first = handStarts(history)[0] ?? 1

  const controls = canSeek ? (
    <span className="controls timeshift">
      <button type="button" title="Previous hand" aria-label="previous hand" onClick={() => seek(prevHand(history, pos))}>
        ⏮
      </button>
      {past ? (
        <button type="button" onClick={() => setPast((p) => p && { ...p, playing: !p.playing })}>
          {past.playing ? 'Pause' : 'Play'}
        </button>
      ) : null}
      <button type="button" title="Next hand" aria-label="next hand" disabled={!past} onClick={() => seek(nextHand(history, pos))}>
        ⏭
      </button>
      <input
        type="range"
        className="seek"
        aria-label="seek through the game"
        min={first}
        max={history.length}
        value={Math.max(first, pos)}
        onChange={(e) => seek(Number(e.target.value))}
      />
      <span className="progress">{past ? `watching hand ${handAt(history, pos)} of ${handStarts(history).length}` : ''}</span>
    </span>
  ) : null

  const shown = past?.state ?? feed
  return (
    <Broadcast
      channel={channel}
      view={shown.view}
      log={shown.log}
      decisionEquity={past ? null : feed.decisionEquity}
      connection={feed.connection}
      controls={controls}
      {...(channel?.mode === 'live' ? { live: { behind: past !== null, onGoLive: () => setPast(null) } } : {})}
    />
  )
}
