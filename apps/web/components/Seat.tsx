'use client'
import type { SeatView, TableView } from '@ab/core/view'
import { characterFor, cueFor, EYE_INK, Mascot } from '@ab/mascot'
import { chips, pct, positionName, shortAction } from '../lib/format'
import { seatMoment } from '../lib/moments'
import { PlayingCard } from './PlayingCard'

/** What a seat card says it did last. */
function lastWord(seat: SeatView): string {
  if (seat.status === 'out') return 'Out'
  if (seat.status === 'folded') return 'Folded'
  return seat.lastAction ? shortAction(seat.lastAction.label) : ''
}

/** What the seat's win chance line reads (on narrow screens, where the players panel is hidden). */
function winWord(view: TableView, seat: SeatView): string {
  if (seat.status === 'folded') return 'Folded'
  if (seat.status === 'out') return 'Out'
  const e = view.equity?.[seat.playerId]
  return e === undefined ? '–' : `${view.equityEstimated ? '≈' : ''}${pct(e)}`
}

/** One seat on the felt: mascot, name, position, stack, cards and what it just did. */
export function Seat({ view, seat, index }: { view: TableView; seat: SeatView; index: number }) {
  const who = characterFor(seat.playerId, index)
  const { moment, jevDecided, key } = seatMoment(view, seat.playerId)
  const acting = view.hand?.toAct === seat.playerId
  const dim = seat.status === 'folded' || seat.status === 'out'
  return (
    <div className={`seat-card${acting ? ' acting' : ''}${dim ? ' dim' : ''}`} style={{ '--seat': who.color } as React.CSSProperties}>
      <div className="seat-head">
        <div className="mascot-box">
          <Mascot shape={who.shape} cue={cueFor(moment, jevDecided)} cueKey={key} size={46} ink={who.color} paper={EYE_INK} title={`${who.name}, ${moment.replace('_', ' ')}`} />
          {seat.position === 'BTN' ? (
            <span className="dealer" title="dealer button">
              D
            </span>
          ) : null}
        </div>
        <div className="seat-id">
          <b>{who.name}</b>
          <small>{positionName(seat.position).toUpperCase()}</small>
          <span className="stack">{chips(seat.stack)}</span>
        </div>
      </div>
      <div className="seat-foot">
        <span className="seat-cards">
          {seat.hole && !dim ? seat.hole.map((c) => <PlayingCard key={c} code={c} small />) : [0, 1].map((i) => <span key={i} className="card gone">–</span>)}
        </span>
        <span className={`act${acting ? ' now' : ''}`}>{acting ? 'Thinking…' : lastWord(seat)}</span>
      </div>
      <div className="seat-win" title="Chance this player wins the hand from here, from everyone's cards. The players can't see it.">
        <span>Win chances</span>
        <b>{winWord(view, seat)}</b>
      </div>
    </div>
  )
}
