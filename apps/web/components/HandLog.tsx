'use client'
import type { TableView } from '@ab/core/view'
import Link from 'next/link'
import { useLayoutEffect, useRef, useState } from 'react'
import { chips, clock } from '../lib/format'
import type { LogLine } from '../lib/log'

export interface HandGroup {
  key: string
  title: string
  meta: string
  /** Newest first, as the log shows them. */
  lines: LogLine[]
}

/**
 * The log grouped by hand, newest hand first, each hand's own lines newest first. A hand still being
 * played says so with its pot and street; a finished one says who won it.
 */
export function handGroups(lines: LogLine[], view: TableView): HandGroup[] {
  const groups: HandGroup[] = []
  for (const line of lines) {
    if (line.kind === 'hand' || groups.length === 0) {
      const number = line.kind === 'hand' ? line.hand : undefined
      groups.push({ key: `${line.seq}`, title: number ? `Hand ${number}` : 'Earlier', meta: '', lines: line.kind === 'hand' ? [] : [line] })
    } else groups.at(-1)!.lines.push(line)
  }
  for (const g of groups) {
    const win = g.lines.find((l) => l.kind === 'win')
    const end = g.lines.find((l) => l.kind === 'end')
    // Short summary: who won how much, without the hand it won with or why.
    g.meta = end ? end.text : win ? win.text.replace(/^(\S+( & \S+)*) wins/, '$1 won').replace(/ (with|\().*$/, '') : ''
    g.lines.reverse()
  }
  const open = groups.at(-1)
  const hand = view.hand
  if (open && !open.meta && hand && !hand.ended) open.meta = `in progress · pot ${chips(hand.pot)} · ${hand.street}`
  return groups.reverse()
}

/**
 * The running hand log. On a phone it is a box of one fixed height, whatever the hand count: the
 * newest rows fill it, older ones fade out under its edge, and a button opens the rest in place. It
 * doesn't scroll inside itself (that fought the page's section snapping), and it doesn't link away
 * (the replay page showed the same box with the same button). `gameLink` is off on a replay page,
 * which is itself where every hand of the game is.
 */
export function HandLog({ lines, view, gameLink = true }: { lines: LogLine[]; view: TableView; gameLink?: boolean }) {
  const groups = handGroups(lines, view)
  const [all, setAll] = useState(false)
  // Whether the box is hiding anything, measured rather than guessed from counts: rows differ in height.
  const body = useRef<HTMLDivElement>(null)
  const [clipped, setClipped] = useState(false)
  useLayoutEffect(() => {
    const el = body.current
    if (el) setClipped(el.scrollHeight > el.clientHeight + 1)
  })
  return (
    <section className={`log${all ? ' expanded' : ''}`} aria-label="hand log">
      <h2>
        HAND LOG <span>newest first</span>
      </h2>
      <div className="log-body" ref={body}>
        {groups.map((g) => (
          <div className="hand-group" key={g.key}>
            <div className="hand-head">
              <b>{g.title}</b>
              <span>{g.meta}</span>
            </div>
            <ol>
              {g.lines.map((l) => (
                <li key={l.seq} className={l.kind}>
                  <span className="at">{clock(l.ts)}</span>
                  <span className={`tag ${l.tag.toLowerCase().replace('-', '')}`}>{l.tag}</span>
                  <span className="what">{l.text}</span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      {/* Always there, only shown when it has something to open: appearing would change the box's size. */}
      <button type="button" className={`more-hands${all || clipped ? '' : ' idle'}`} aria-expanded={all} onClick={() => setAll((a) => !a)}>
        {all ? 'Show fewer' : `Show all ${groups.length} ${groups.length === 1 ? 'hand' : 'hands'}`}
      </button>
      {gameLink && view.status === 'ended' && view.gameId ? (
        <Link className="all-hands" href={`/replays/${encodeURIComponent(view.gameId)}`}>
          Every hand from this game
        </Link>
      ) : null}
    </section>
  )
}
