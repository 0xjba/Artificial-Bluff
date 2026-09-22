'use client'
import type { TableView } from '@ab/core/view'
import { characterFor, cueFor, EYE_INK, Mascot } from '@ab/mascot'
import { chips, ms, pct, shortModel, signedChips, usd } from '../lib/format'

/** Who is playing: each seat's model, stack, net result, win chance, speed and spend. */
export function PlayersPanel({ view }: { view: TableView }) {
  if (view.seats.length === 0) return null
  return (
    <section className="players" aria-label="who is playing">
      <h2>WHO IS PLAYING</h2>
      {view.seats.map((s, i) => {
        const who = characterFor(s.playerId, i)
        const net = s.startingStack === null ? 0 : s.stack - s.startingStack
        const equity = view.equity?.[s.playerId]
        const folded = s.status === 'folded' || s.status === 'out'
        const acting = view.hand?.toAct === s.playerId
        return (
          <article key={s.playerId} className={`player${acting ? ' acting' : ''}${folded ? ' dim' : ''}`} style={{ '--seat': who.color } as React.CSSProperties}>
            <div className="player-top">
              <Mascot shape={who.shape} cue={cueFor('waiting')} size={34} ink={who.color} paper={EYE_INK} frozenAt={99} />
              <div className="player-id">
                <b>{who.name}</b>
                <small title={s.model}>{s.kind === 'jev' ? `${shortModel(s.model)} · TypeSafe` : shortModel(s.model)}</small>
              </div>
              <div className="player-stack">
                <b>{chips(s.stack)}</b>
                <small className={net < 0 ? 'down' : 'up'}>{signedChips(net)}</small>
              </div>
            </div>
            <div className="player-win">
              <span className="bar">
                <span style={{ width: `${Math.round((folded ? 0 : (equity ?? 0)) * 100)}%` }} />
              </span>
              <span>
                Win chances <b>{folded ? (s.status === 'out' ? 'Out' : 'Folded') : equity === undefined ? '–' : `${view.equityEstimated ? '≈' : ''}${pct(equity)}`}</b>
              </span>
            </div>
            <div className="player-stats">
              <div>
                <span>AVG LATENCY</span>
                <b>{s.decisions ? ms(s.latencyMsTotal / s.decisions) : '–'}</b>
              </div>
              <div>
                <span>SPENT</span>
                <b>{usd(s.costUsd)}</b>
              </div>
            </div>
          </article>
        )
      })}
    </section>
  )
}
