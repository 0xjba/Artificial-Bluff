'use client'
import type { TableView } from '@ab/core/view'
import { characterFor } from '@ab/mascot'
import { chips, ms, shortModel, usd } from '../lib/format'

/** Per seat: stack, running cost, average decision latency, fallbacks. */
export function Scoreboard({ view }: { view: TableView }) {
  if (view.seats.length === 0) return null
  return (
    <section className="scoreboard" aria-label="scoreboard">
      <table>
        <thead>
          <tr>
            <th>Seat</th>
            <th className="n">Stack</th>
            <th className="n">Cost</th>
            <th className="n">Avg time</th>
            <th className="n">Fallbacks</th>
          </tr>
        </thead>
        <tbody>
          {view.seats.map((s, i) => (
            <tr key={s.playerId} className={s.kind === 'jev' ? 'jev' : ''}>
              <td>
                <b>{characterFor(s.playerId, i).name}</b> <small>{shortModel(s.model)}</small>
              </td>
              <td className="n">{chips(s.stack)}</td>
              <td className="n">{usd(s.costUsd)}</td>
              <td className="n">{s.decisions ? ms(s.latencyMsTotal / s.decisions) : '–'}</td>
              <td className="n">{s.fallbacks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
