'use client'
import type { TableView } from '@ab/core/view'
import { chips } from '../lib/format'
import { PlayingCard } from './PlayingCard'
import { Seat } from './Seat'

/** Seat places on the portrait felt (percent), first seat at the bottom, by number of seats. */
const PLACES: Record<number, Array<{ left: number; top: number }>> = {
  2: [
    { left: 50, top: 95 },
    { left: 50, top: 7 },
  ],
  3: [
    { left: 50, top: 95 },
    { left: 16, top: 20 },
    { left: 84, top: 20 },
  ],
  4: [
    { left: 50, top: 95 },
    { left: 13, top: 52 },
    { left: 50, top: 7 },
    { left: 87, top: 52 },
  ],
  5: [
    { left: 50, top: 95 },
    { left: 13, top: 74 },
    { left: 13, top: 14 },
    { left: 87, top: 14 },
    { left: 87, top: 74 },
  ],
}

/** Where seat i of n sits on the felt; seats beyond the fixed places go round an ellipse. */
export function seatPlace(i: number, n: number): { left: number; top: number } {
  const fixed = PLACES[n]?.[i]
  if (fixed) return fixed
  const angle = Math.PI / 2 + (i * 2 * Math.PI) / n
  return { left: 50 + 40 * Math.cos(angle), top: 50 + 46 * Math.sin(angle) }
}

/** What the middle of the felt says under the board. */
function centreLine(view: TableView): string {
  const hand = view.hand
  if (view.result) return `${view.result.reason === 'budget_cap' ? 'Budget cap reached' : 'Game over'} · ${view.result.reason.replace('_', ' ')}`
  if (!hand) return view.status === 'waiting' ? 'Waiting for the next hand' : ''
  if (hand.ended) return 'Hand over'
  const call = hand.options?.find((o) => o.id === 'call')
  const amount = call ? call.label.replace(/^Call( all-in)? /, '') : null
  return amount ? `TO CALL ${amount}` : hand.street.toUpperCase()
}

/** The portrait felt: seats around the rim, pot and board in the middle. */
export function Stage({ view }: { view: TableView }) {
  const hand = view.hand
  const board = hand?.board ?? []
  return (
    <div className="stage">
      <div className="felt" role="region" aria-label="poker table">
        <div className="centre">
          <div className="pot">
            <span>POT</span>
            <b>{chips(hand?.pot ?? 0)}</b>
          </div>
          <div className="board">
            {[0, 1, 2, 3, 4].map((i) => (board[i] ? <PlayingCard key={board[i]} code={board[i]!} /> : <span key={i} className="card slot" />))}
          </div>
          <span className="centre-line">{centreLine(view)}</span>
        </div>
        {view.seats.map((seat, i) => {
          const place = seatPlace(i, view.seats.length)
          return (
            <div key={seat.playerId} className="seat-slot" style={{ '--l': place.left, '--t': place.top } as React.CSSProperties}>
              <Seat view={view} seat={seat} index={i} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
