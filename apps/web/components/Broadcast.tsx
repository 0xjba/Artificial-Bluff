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

/** Speaker, with a slash through it when the sound is off. */
function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M3 6.2h2.2L8.4 3.4v9.2L5.2 9.8H3z" fill="currentColor" />
      {on ? (
        <>
          <path d="M10.6 5.8a3 3 0 0 1 0 4.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M12.4 4a5.4 5.4 0 0 1 0 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </>
      ) : (
        <path d="M10.8 6.2l3.4 3.6M14.2 6.2l-3.4 3.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      )}
    </svg>
  )
}

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
      {/* On a phone only the first part (the hand) fits beside the logo and the menu. */}
      {programmeStatus(props.channel, props.view).map((part, i) => (
        <span key={part} className={i === 0 ? 'part' : 'part extra'}>
          {part}
        </span>
      ))}
      {props.connection === 'lost' ? <span className="warn">RECONNECTING…</span> : null}
      <button type="button" className="mute" onClick={toggle} title={muted ? 'Turn sound on' : 'Turn sound off'} aria-label={muted ? 'turn sound on' : 'turn sound off'} aria-pressed={!muted}>
        <SoundIcon on={!muted} />
      </button>
    </>
  )

  return (
    <div className="broadcast">
      {slot ? createPortal(status, slot) : <div className="programme in-page">{status}</div>}
      {props.controls ? <div className="programme">{props.controls}</div> : null}
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
