'use client'
import type { TableView } from '@ab/core/view'
import { chips } from '../lib/format'
import { PlayingCard } from './PlayingCard'
import { Seat } from './Seat'

/** Seat i of n around the oval, clockwise from the bottom centre (percent of the table box). */
export function seatPosition(i: number, n: number): { left: number; top: number } {
  const angle = Math.PI / 2 + (i * 2 * Math.PI) / n
  // On the rim, so the middle of the felt stays clear for the board and pot.
  return { left: 50 + 47 * Math.cos(angle), top: 50 + 49 * Math.sin(angle) }
}

/** The felt: seats around it, the board and pot in the middle. */
export function Table({ view }: { view: TableView }) {
  const hand = view.hand
  const board = hand?.board ?? []
  return (
    <div className="table-wrap">
      <div className="felt" role="region" aria-label="poker table">
        <div className="centre">
          <div className="board">
            {[0, 1, 2, 3, 4].map((i) => (board[i] ? <PlayingCard key={board[i]} code={board[i]!} /> : <span key={i} className="card slot" />))}
          </div>
          <div className="pot">
            {hand ? (
              <>
                POT <b>{chips(hand.pot)}</b> · {hand.street.toUpperCase()} · blinds {chips(hand.smallBlind)}/{chips(hand.bigBlind)}
              </>
            ) : view.status === 'waiting' ? (
              'Waiting for the next hand'
            ) : null}
          </div>
          {view.result ? (
            <div className="result">
              {view.result.winner ? `${view.result.winner.toUpperCase()} WINS` : 'GAME OVER'} · {view.result.reason.replace('_', ' ')}
            </div>
          ) : null}
        </div>
        {view.seats.map((seat, i) => {
          const pos = seatPosition(i, view.seats.length)
          return (
            <div key={seat.playerId} className="seat-slot" style={{ left: `${pos.left}%`, top: `${pos.top}%` }}>
              <Seat view={view} seat={seat} index={i} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
