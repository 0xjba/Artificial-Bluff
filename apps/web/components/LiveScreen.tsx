'use client'
import { characterFor } from '@ab/mascot'
import { useEffect, useRef, useState } from 'react'
import { reduceFeed, type FeedState } from '../lib/feed'
import { feedAt, handAt, handStarts, nextHand, prevHand, seekable } from '../lib/timeshift'
import { Broadcast } from './Broadcast'
import { SeekBar } from './SeekBar'
import { replayPause } from './ReplayScreen'
import { useFeed } from './useFeed'

const name = (id: string) => characterFor(id).name

/** Watching the past of the live game: how many events are shown, that screen, and whether it plays on. */
interface Past {
  /** The programme and feed snapshot it was built from: a new programme or a reconnect returns to live. */
  channelId: string
  snapshot: number
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
  const [stored, setPast] = useState<Past | null>(null)
  // Derived while rendering (not reset in an effect), so the old game never shows for a frame.
  const past = stored && stored.channelId === channel?.id && stored.snapshot === feed.snapshots ? stored : null
  const historyRef = useRef(history)
  historyRef.current = history

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

  // Seeking needs the whole programme from its start with nothing missing (the backlog may still be
  // loading). A replay can be scrubbed too: its events arrive on the same feed.
  const canSeek = seekable(history)
  const seekTo = (pos: number | null) => {
    if (!channel || pos === null || pos >= history.length) return setPast(null)
    const playing = past?.playing ?? true
    setPast({ channelId: channel.id, snapshot: feed.snapshots, pos, state: feedAt(channel, history, pos, name), playing })
  }
  const pos = past?.pos ?? history.length

  const seek = canSeek ? (
    <SeekBar
      total={history.length}
      pos={pos}
      starts={handStarts(history)}
      hand={{ at: handAt(history, pos), of: handStarts(history).length }}
      behind={past !== null}
      playing={past?.playing ?? true}
      onSeek={seekTo}
      onPrevHand={() => seekTo(prevHand(history, pos))}
      onNextHand={() => seekTo(nextHand(history, pos))}
      onTogglePlay={() => setPast((p) => p && { ...p, playing: !p.playing })}
      mode={channel?.mode ?? 'idle'}
    />
  ) : null

  const shown = past?.state ?? feed
  return (
    <Broadcast
      channel={channel}
      view={shown.view}
      log={shown.log}
      decisionEquity={past ? null : feed.decisionEquity}
      connection={feed.connection}
      seek={seek}
      explainer
      {...(channel?.mode === 'live' ? { live: { behind: past !== null, onGoLive: () => setPast(null) } } : {})}
    />
  )
}
