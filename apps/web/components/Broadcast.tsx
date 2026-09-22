'use client'
import type { TableView } from '@ab/core/view'
import type { Channel } from '@ab/server'
import { useEffect, useRef, useState } from 'react'
import type { LogLine } from '../lib/log'
import { playSound, soundFor, unlockAudio } from '../lib/sounds'
import { ActionLog } from './ActionLog'
import { LowerThird } from './LowerThird'
import { Scoreboard } from './Scoreboard'
import { Table } from './Table'

const MUTE_KEY = 'artificialBluff.muted'

/** The whole spectator screen for one programme (live or replay): table, lower third, scoreboard, log. */
export function Broadcast(props: {
  channel: Pick<Channel, 'mode' | 'title'> | null
  view: TableView
  log: LogLine[]
  decisionEquity: number | null
  /** Feed connection, for the live screen: 'lost' shows a notice. */
  connection?: 'connecting' | 'open' | 'lost'
  controls?: React.ReactNode
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
  // One sound per new log line. Lines are new objects, so a restart or a new programme (whose event
  // numbers start low again) still makes sound; a snapshot clears the log, so joining is silent.
  const lastLine = useRef<LogLine | undefined>(undefined)
  const newest = props.log.at(-1)
  useEffect(() => {
    if (!newest || newest === lastLine.current) return
    lastLine.current = newest
    const sound = soundFor(newest.kind, newest.text)
    if (!muted && sound) playSound(sound)
  }, [newest, muted])

  const mode = props.channel?.mode ?? 'idle'
  return (
    <div className="broadcast">
      <div className="programme">
        <span className={`tag ${mode}`}>{mode === 'live' ? '● LIVE' : mode === 'replay' ? 'REPLAY' : 'OFF AIR'}</span>
        <span className="title">{props.channel?.title ?? 'Connecting…'}</span>
        {props.connection === 'lost' ? <span className="warn">reconnecting…</span> : null}
        {props.controls}
        <button type="button" className="mute" onClick={toggle}>
          {muted ? 'Sound off' : 'Sound on'}
        </button>
      </div>
      <div className="stage">
        <div className="main">
          <Table view={props.view} />
          <LowerThird view={props.view} decisionEquity={props.decisionEquity} />
        </div>
        <aside>
          <Scoreboard view={props.view} />
          <ActionLog lines={props.log} />
        </aside>
      </div>
    </div>
  )
}
