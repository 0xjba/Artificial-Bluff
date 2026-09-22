'use client'
import type { TableView } from '@ab/core/view'
import type { Channel } from '@ab/server'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { chips } from '../lib/format'
import type { LogLine } from '../lib/log'
import { playSound, soundFor, unlockAudio } from '../lib/sounds'
import { DecisionCard } from './DecisionCard'
import { HandLog } from './HandLog'
import { NewHere } from './NewHere'
import { PlayersPanel } from './PlayersPanel'
import { Stage } from './Stage'

const MUTE_KEY = 'artificialBluff.muted'

/**
 * What the header says beside the tag: a live game shows its hand number and blinds, a replay its
 * subject ("REPLAY · live game x" → "live game x"), so the tag is never repeated.
 */
export function programmeStatus(channel: Pick<Channel, 'mode' | 'title'> | null, view: TableView): string[] {
  if (!channel) return ['CONNECTING…']
  if (channel.mode !== 'live') return [channel.title.replace(/^REPLAY\s*·\s*/i, '')]
  const hand = view.hand && !view.hand.ended ? view.handsPlayed + 1 : view.handsPlayed
  const parts: string[] = []
  if (hand > 0) parts.push(`HAND ${hand}`)
  if (view.hand) parts.push(`BLINDS ${chips(view.hand.smallBlind)}/${chips(view.hand.bigBlind)}`)
  return parts
}

/** The whole spectator screen for one programme: players, the felt, the last decision and the hand log. */
export function Broadcast(props: {
  channel: Pick<Channel, 'mode' | 'title'> | null
  view: TableView
  log: LogLine[]
  decisionEquity: number | null
  /** Feed connection, for the live screen: 'lost' shows a notice. */
  connection?: 'connecting' | 'open' | 'lost'
  /** Buttons for this programme (replay speed, stopping a browser table…), shown in the strip. */
  controls?: React.ReactNode
  /** The seek bar, under the table. */
  seek?: React.ReactNode
  /** Live time shift: `behind` dims the LIVE tag (watching the past); clicking it returns to live. */
  live?: { behind: boolean; onGoLive: () => void }
  /** The one-line explainer for newcomers (the home page shows it). */
  explainer?: boolean
}) {
  const [muted, setMuted] = useState(true)
  useEffect(() => {
    try {
      setMuted(localStorage.getItem(MUTE_KEY) !== '0')
    } catch {
      // storage unavailable: stay muted
    }
  }, [])
  const toggle = () => {
    if (muted) unlockAudio() // browsers only allow audio after a click
    setMuted((m) => {
      try {
        localStorage.setItem(MUTE_KEY, m ? '0' : '1')
      } catch {
        // not persisted
      }
      return !m
    })
  }
  // One sound per line added to the log. A log rebuilt at once (joining, seeking, back to live, a
  // restart) is silent: only a line appended after the previous newest one makes a sound.
  const lastLine = useRef<LogLine | undefined>(undefined)
  const newest = props.log.at(-1)
  const previous = props.log.at(-2)
  useEffect(() => {
    const before = lastLine.current
    lastLine.current = newest
    if (!newest || newest === before || previous !== before) return
    const sound = soundFor(newest.kind, newest.text)
    if (!muted && sound) playSound(sound)
  }, [newest, previous, muted])

  const mode = props.channel?.mode ?? 'idle'
  const tag = mode === 'live' ? 'LIVE' : mode === 'replay' ? 'REPLAY' : 'OFF AIR'
  // The programme's state belongs at the right of the site header (design), which the layout renders.
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => setSlot(document.getElementById('site-status')), [])
  const status = (
    <>
      {mode === 'live' && props.live ? (
        <button
          type="button"
          className={`tag live${props.live.behind ? ' behind' : ''}`}
          onClick={props.live.onGoLive}
          title={props.live.behind ? 'Back to live' : 'You are watching live'}
        >
          <span className="blip" />
          {tag}
        </button>
      ) : (
        <span className={`tag ${mode}`}>
          {mode === 'live' ? <span className="blip" /> : null}
          {tag}
        </span>
      )}
      {programmeStatus(props.channel, props.view).map((part) => (
        <span key={part}>{part}</span>
      ))}
      {props.connection === 'lost' ? <span className="warn">RECONNECTING…</span> : null}
    </>
  )

  return (
    <div className="broadcast">
      {slot ? createPortal(status, slot) : <div className="programme in-page">{status}</div>}
      <div className="programme">
        {props.controls}
        <button type="button" className="mute" onClick={toggle}>
          {muted ? 'Sound off' : 'Sound on'}
        </button>
      </div>
      {props.explainer ? <NewHere /> : null}
      <div className="stage-grid">
        <PlayersPanel view={props.view} />
        <Stage view={props.view} />
        <aside className="side">
          <DecisionCard view={props.view} decisionEquity={props.decisionEquity} />
          <HandLog lines={props.log} view={props.view} />
        </aside>
      </div>
      {props.seek}
    </div>
  )
}
