'use client'
import type { TableView } from '@ab/core/view'
import Link from 'next/link'
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
    g.meta = end ? end.text : win ? win.text.replace(/^(\S+( & \S+)*) (wins|split)/, '$1 won').replace(/ (with|\().*$/, '') : ''
    g.lines.reverse()
  }
  const open = groups.at(-1)
  const hand = view.hand
  if (open && !open.meta && hand && !hand.ended) open.meta = `in progress · pot ${chips(hand.pot)} · ${hand.street}`
  return groups.reverse()
}

/** The running hand log. */
export function HandLog({ lines, view }: { lines: LogLine[]; view: TableView }) {
  const groups = handGroups(lines, view)
  return (
    <section className="log" aria-label="hand log">
      <h2>
        HAND LOG <span>newest first</span>
      </h2>
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
      {view.status === 'ended' && view.gameId ? (
        <Link className="all-hands" href={`/replays/${encodeURIComponent(view.gameId)}`}>
          Every hand from this game
        </Link>
      ) : null}
    </section>
  )
}
