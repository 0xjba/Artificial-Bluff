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
 * Turns off the page's section snapping until the reader next scrolls and stops. Resuming at once would
 * re-snap straight away and undo whatever was just held in place.
 */
function pauseSnapping() {
  const page = document.documentElement
  if (page.style.scrollSnapType === 'none') return
  page.style.scrollSnapType = 'none'
  let settle: ReturnType<typeof setTimeout> | undefined
  const onScroll = () => {
    clearTimeout(settle)
    settle = setTimeout(() => {
      page.style.scrollSnapType = ''
      window.removeEventListener('scroll', onScroll)
    }, 180)
  }
  // Our own correction scrolls the page once; only the reader's scrolling after it counts.
  requestAnimationFrame(() => requestAnimationFrame(() => window.addEventListener('scroll', onScroll, { passive: true })))
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
  // Opening and closing push the page down from the log's top, like any disclosure: without this the
  // browser holds the button (or the footer) still instead, and the log seems to grow upward.
  const section = useRef<HTMLElement>(null)
  const pinnedTop = useRef<number | null>(null)
  const toggle = () => {
    pinnedTop.current = section.current?.getBoundingClientRect().top ?? null
    // A phone's page snaps between sections, and re-snaps whenever one changes height: it would pull
    // the page to a section edge the moment the log opened. Paused until the next scroll settles.
    pauseSnapping()
    setAll((a) => !a)
  }
  useLayoutEffect(() => {
    const before = pinnedTop.current
    pinnedTop.current = null
    if (before === null || !section.current) return
    // Closed from far down an open log, its top was off the screen: bring it back under the header.
    const header = document.querySelector('header.site')?.getBoundingClientRect().bottom ?? 0
    const target = Math.max(before, header)
    const moved = section.current.getBoundingClientRect().top - target
    if (moved !== 0) window.scrollBy({ top: moved, behavior: 'instant' })
  }, [all])
  // Whether the box is hiding anything, measured rather than guessed from counts: rows differ in height.
  const body = useRef<HTMLDivElement>(null)
  const [clipped, setClipped] = useState(false)
  useLayoutEffect(() => {
    const el = body.current
    if (el) setClipped(el.scrollHeight > el.clientHeight + 1)
  })
  return (
    <section ref={section} className={`log${all ? ' expanded' : ''}`} aria-label="hand log">
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
      <button type="button" className={`more-hands${all || clipped ? '' : ' idle'}`} aria-expanded={all} onClick={toggle}>
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
