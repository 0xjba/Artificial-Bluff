'use client'
import type { GameEvent } from '@ab/core/view'
import { characterFor } from '@ab/mascot'
import type { FeedMessage } from '@ab/server'
import { useEffect, useReducer, useState } from 'react'
import { initialFeed, reduceFeed, type FeedState } from '../lib/feed'
import { Broadcast } from './Broadcast'

const name = (id: string) => characterFor(id).name
const CHANNEL = { id: 'replay', mode: 'replay' as const, title: '', gameId: null }

/** Pause after an event at 1x, in ms (decisions and streets take a beat, like the live table). */
export function replayPause(e: GameEvent): number {
  return e.type === 'decision' ? 1400 : e.type === 'street_dealt' ? 700 : e.type === 'hand_ended' ? 2200 : e.type === 'game_ended' ? 3000 : 0
}

type Action = { type: 'reset' } | { type: 'event'; event: GameEvent }

/** Plays a finished game's events in the browser, with pause and speed controls. */
export function ReplayScreen({ title, events }: { title: string; events: GameEvent[] }) {
  const [state, dispatch] = useReducer((s: FeedState, a: Action) => {
    const m: FeedMessage =
      a.type === 'reset'
        ? { type: 'snapshot', channel: { ...CHANNEL, title }, view: initialFeed().view }
        : { type: 'event', channelId: 'replay', event: a.event }
    return reduceFeed(s, m, name)
  }, undefined, () => reduceFeed(initialFeed(), { type: 'snapshot', channel: { ...CHANNEL, title }, view: initialFeed().view }, name))
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)

  useEffect(() => {
    if (!playing || index >= events.length) return
    const e = events[index]!
    dispatch({ type: 'event', event: e })
    const timer = setTimeout(() => setIndex((i) => i + 1), replayPause(e) / speed)
    return () => clearTimeout(timer)
  }, [index, playing, speed, events])

  const restart = () => {
    dispatch({ type: 'reset' })
    setIndex(0)
    setPlaying(true)
  }
  const controls = (
    <span className="controls">
      <button type="button" onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play'}</button>
      {[1, 2, 4].map((s) => (
        <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
          {s}x
        </button>
      ))}
      <button type="button" onClick={restart}>Restart</button>
      <span className="progress">
        {Math.min(index, events.length)} / {events.length}
      </span>
    </span>
  )
  return <Broadcast channel={state.channel} view={state.view} log={state.log} decisionEquity={null} controls={controls} />
}
