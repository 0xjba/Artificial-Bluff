import type { ModelsTable } from '@ab/server'
import { characterFor } from '@ab/mascot'
import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { MascotBadge } from '../../components/MascotBadge'
import { API_URL } from '../../lib/api'
import { chips, ms, pct, shortModel, signedChips, usd } from '../../lib/format'

export const metadata: Metadata = { title: 'Models · artificialBluff' }

/** What every model has done, summed over the finished live games (the server does the arithmetic). */
async function loadModels(): Promise<ModelsTable | null> {
  try {
    const res = await fetch(`${API_URL}/api/models`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return null
    return (await res.json()) as ModelsTable
  } catch {
    return null
  }
}

const one = (x: number | null, digits = 1) => (x === null ? '–' : x.toFixed(digits))
const signedPts = (pts: number | null) => (pts === null ? '–' : `${pts > 0 ? '+' : pts < 0 ? '−' : ''}${Math.abs(pts).toFixed(0)} pts`)
const absPts = (pts: number | null) => (pts === null ? '–' : `${pts.toFixed(0)} pts`)

/** How a seat plays, in one line, from its measured style. */
function styleLine(s: ModelsTable['seats'][number]): string {
  const parts: string[] = []
  if (s.style.vpip !== null) parts.push(`plays ${pct(s.style.vpip)} of hands`)
  if (s.style.pfr !== null) parts.push(`raises first in ${pct(s.style.pfr)}`)
  if (s.style.wtsd !== null) parts.push(`reaches showdown ${pct(s.style.wtsd)}`)
  return parts.join(' · ') || 'not enough hands yet'
}

export default async function Models() {
  await connection()
  const table = await loadModels()
  return (
    <div className="page models">
      <span className="kicker">THE TABLE</span>
      <h1>{table && table.seats.length ? `${table.seats.length} seats, one set of rules` : 'The table'}</h1>
      <p className="lede">
        Each mascot is a permanent seat; the model behind it can change between games. Everything here is measured from the event log of every hand played:
        chips, decision time, spend, and how far each model&apos;s stated win chance sat from the true one.
      </p>
      {!table ? (
        <p className="warn">The live server isn&apos;t reachable, so there is nothing to show.</p>
      ) : table.seats.length === 0 ? (
        <p className="muted">No game has finished yet. This page fills in once the first live game ends.</p>
      ) : (
        <>
          <p className="muted">
            {table.games} finished {table.games === 1 ? 'game' : 'games'} · {table.hands} hands
          </p>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Seat and model</th>
                  <th className="n">Chips won</th>
                  <th className="n">Hands</th>
                  <th className="n">Win rate</th>
                  <th className="n">Avg time</th>
                  <th className="n" title="Mean |stated − true| win chance">Avg error</th>
                  <th className="n" title="Mean (stated − true) win chance: over and under cancel">Leans</th>
                </tr>
              </thead>
              <tbody>
                {table.seats.map((s, i) => {
                  const who = characterFor(s.playerId, i)
                  return (
                    <tr key={s.playerId} className={s.kind === 'jev' ? 'jev' : ''}>
                      <td>{i + 1}</td>
                      <td>
                        <div className="seat-cell">
                          <MascotBadge playerId={s.playerId} index={i} size={26} />
                          <div>
                            <b>{who.name}</b> <span className="badge">{shortModel(s.model)}</span>
                            {s.models.length > 1 ? <span className="badge"> +{s.models.length - 1} more</span> : null}
                            <div className="style">{styleLine(s)}</div>
                          </div>
                        </div>
                      </td>
                      <td className={`n ${s.chipsWon < 0 ? 'down' : 'up'}`}>{signedChips(s.chipsWon)}</td>
                      <td className="n">{s.hands}</td>
                      <td className="n">{pct(s.winRate)}</td>
                      <td className="n">{ms(s.latencyMeanMs)}</td>
                      <td className="n">{absPts(s.errorPts)}</td>
                      <td className="n">{signedPts(s.biasPts)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <h2 className="section">SEAT DOSSIERS</h2>
          <div className="dossiers">
            {table.seats.map((s, i) => {
              const who = characterFor(s.playerId, i)
              const bars: Array<[string, number | null]> = [
                ['PLAYS HANDS', s.style.vpip],
                ['RAISES FIRST IN', s.style.pfr],
                ['TO SHOWDOWN', s.style.wtsd],
              ]
              return (
                <article className="panel dossier" key={s.playerId} style={{ '--seat': who.color } as React.CSSProperties}>
                  <div className="dossier-top">
                    <MascotBadge playerId={s.playerId} index={i} size={40} />
                    <div>
                      <b>{who.name}</b>
                      <small>{s.models.map(shortModel).join(', ')}</small>
                    </div>
                  </div>
                  {bars.map(([label, value]) => (
                    <div className="dossier-bar" key={label}>
                      <span>{label}</span>
                      <span className="bar">
                        <span style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
                      </span>
                      <b>{pct(value)}</b>
                    </div>
                  ))}
                  <dl>
                    <div>
                      <dt>AGGRESSION</dt>
                      <dd>{one(s.style.af, 2)}</dd>
                    </div>
                    <div>
                      <dt>SPENT</dt>
                      <dd>{usd(s.costUsd)}</dd>
                    </div>
                    <div>
                      <dt>PER DECISION</dt>
                      <dd>{s.costPerDecisionUsd === null ? '–' : usd(s.costPerDecisionUsd)}</dd>
                    </div>
                    <div>
                      <dt>FALLBACKS</dt>
                      <dd>{s.fallbacks}</dd>
                    </div>
                    <div>
                      <dt>PER 100 HANDS</dt>
                      <dd>{s.bb100 === null ? '–' : `${one(s.bb100)} bb`}</dd>
                    </div>
                    <div>
                      <dt>DECISIONS</dt>
                      <dd>{chips(s.decisions)}</dd>
                    </div>
                  </dl>
                </article>
              )
            })}
          </div>
        </>
      )}
      <section className="method">
        <h2 className="section">HOW THESE ARE MEASURED</h2>
        <p className="muted">
          Win rate is hands won of hands dealt. The honesty gap is the mean difference between the win chance a model stated before acting and the true chance
          worked out from every hole card, in percentage points; a positive number means it talked itself up. Jev answers with a probability for each option
          instead of a win chance, so it has no gap. Aggression is postflop bets and raises per call. Average time is the wall clock per decision, and fallbacks
          count decisions where a seat was played check-or-fold after a timeout or an invalid answer. <Link href="/research">Read the method</Link>.
        </p>
      </section>
    </div>
  )
}
