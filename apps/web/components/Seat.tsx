'use client'
import type { SeatView, TableView } from '@ab/core/view'
import { characterFor, cueFor, Mascot } from '@ab/mascot'
import { chips, ms, pct, shortModel } from '../lib/format'
import { seatMoment } from '../lib/moments'
import { PlayingCard } from './PlayingCard'

/** What the seat's win bar means (spectators see every hand; the players never see this). */
export const EQUITY_HELP = 'Chance this player wins the hand from here, worked out by the broadcast from everyone\'s cards. The players can\'t see it.'

const STATUS: Record<SeatView['status'], string> = { active: '', folded: 'FOLDED', all_in: 'ALL-IN', out: 'OUT' }

/** One seat: mascot, character name, model badge, stack, cards, last action, latency, true equity. */
export function Seat({ view, seat, index }: { view: TableView; seat: SeatView; index: number }) {
  const who = characterFor(seat.playerId, index)
  const { moment, jevDecided, key } = seatMoment(view, seat.playerId)
  const toAct = view.hand?.toAct === seat.playerId
  const equity = view.equity?.[seat.playerId]
  return (
    <div className={`seat${toAct ? ' to-act' : ''}${seat.status === 'folded' || seat.status === 'out' ? ' dim' : ''}${seat.kind === 'jev' ? ' jev' : ''}`}>
      <div className="seat-top">
        <div className="seat-mascot">
          <Mascot shape={who.shape} cue={cueFor(moment, jevDecided)} cueKey={key} size={64} paper="#0E3029" title={`${who.name}, ${moment.replace('_', ' ')}`} />
          {seat.position === 'BTN' ? <span className="dealer" title="dealer button">D</span> : null}
        </div>
        <div className="seat-id">
          <div className="seat-name">
            <b>{who.name}</b> <span className="badge" title={seat.model}>{shortModel(seat.model)}</span>
          </div>
          <div className="seat-stack">
            {chips(seat.stack)} <small>{seat.position ?? ''}</small> {STATUS[seat.status] ? <em>{STATUS[seat.status]}</em> : null}
            {seat.bet > 0 ? <span className="bet" title="chips bet this street">{chips(seat.bet)}</span> : null}
          </div>
        </div>
      </div>
      <div className="seat-row">
        <span className="seat-cards">{seat.hole ? seat.hole.map((c) => <PlayingCard key={c} code={c} small />) : null}</span>
        <span className="last">{seat.lastAction ? seat.lastAction.label : '–'}</span>
        <span className="latency" title="how long the last decision took">{ms(seat.lastLatencyMs)}</span>
      </div>
      {equity !== undefined ? (
        <div className="equity" title={EQUITY_HELP + (view.equityEstimated ? ' ≈ means estimated by dealing out many random boards.' : '')}>
          <span style={{ width: `${Math.round(equity * 100)}%` }} />
          <b>{`Win ${view.equityEstimated ? '≈' : ''}${pct(equity)}`}</b>
        </div>
      ) : null}
    </div>
  )
}
