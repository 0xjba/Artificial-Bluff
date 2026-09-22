import type { ModelsTable, SeatSummary } from '@ab/server'
import { characterFor } from '@ab/mascot'
import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { MascotBadge } from '../../components/MascotBadge'
import { API_URL } from '../../lib/api'
import { ms, pct, shortModel, signedChips, usd } from '../../lib/format'

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

const absPts = (pts: number | null) => (pts === null ? '–' : `${pts.toFixed(0)} pts`)
const signedPts = (pts: number | null) => (pts === null ? '–' : `${pts > 0 ? '+' : pts < 0 ? '−' : ''}${Math.abs(pts).toFixed(0)} pts`)

/** How a seat plays, in one line, from its measured style. */
function styleLine(s: SeatSummary): string {
  const parts: string[] = []
  if (s.style.vpip !== null) parts.push(`plays ${pct(s.style.vpip)} of hands`)
  if (s.style.pfr !== null) parts.push(`raises first in ${pct(s.style.pfr)}`)
  if (s.style.wtsd !== null) parts.push(`reaches showdown ${pct(s.style.wtsd)}`)
  return parts.join(' · ') || 'not enough hands yet'
}

export default async function Models() {
  await connection()
  const table = await loadModels()
  const seats = table?.seats ?? []

  return (
    <div className="models">
      <header className="models-head">
        <span className="kicker">THE TABLE</span>
        <h1>{seats.length ? `${seats.length} seats, ${new Set(seats.map((s) => s.model)).size} models, one set of rules` : 'The table'}</h1>
        <p>
          Each mascot is a permanent seat; the model behind it can change between games. Everything here is measured from the event log of every hand played —
          chips, decision time, spend, and how far each model&apos;s stated win chance sits from the true one.
        </p>
      </header>

      {!table ? (
        <p className="models-empty warn">The live server isn&apos;t reachable, so there is nothing to show.</p>
      ) : seats.length === 0 ? (
        <p className="models-empty muted">No game has finished yet. This page fills in once the first live game ends.</p>
      ) : (
        <>
          <div className="models-scroll">
            <div className="models-board">
              <div className="row-head">
                <span>#</span>
                <span />
                <span>SEAT / MODEL</span>
                <span className="r">CHIPS WON</span>
                <span className="r">HANDS</span>
                <span>WIN RATE</span>
                <span className="r">AVG TIME</span>
                <span className="r">AVG ERROR</span>
              </div>
              {seats.map((s, i) => {
                const who = characterFor(s.playerId, i)
                return (
                  <div className="row" key={s.playerId} style={{ '--seat': who.color } as React.CSSProperties}>
                    <span className="rank">{i + 1}</span>
                    <span className="face">
                      <MascotBadge playerId={s.playerId} index={i} size={28} />
                    </span>
                    <span className="who">
                      <span className="who-top">
                        <b>{who.name}</b>
                        <span className="chip">{shortModel(s.model)}</span>
                        {s.models.length > 1 ? <span className="chip">+{s.models.length - 1} more</span> : null}
                      </span>
                      <span className="style">{styleLine(s)}</span>
                    </span>
                    <span className={`r chips ${s.chipsWon < 0 ? 'down' : 'up'}`}>{signedChips(s.chipsWon)}</span>
                    <span className="r mono">{s.hands}</span>
                    <span className="rate">
                      <span className="bar">
                        <span style={{ width: `${Math.round((s.winRate ?? 0) * 100)}%` }} />
                      </span>
                      <span className="mono">{pct(s.winRate)}</span>
                    </span>
                    <span className="r mono">{ms(s.latencyMeanMs)}</span>
                    <span className="r mono">{absPts(s.errorPts)}</span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="models-section">
            <span className="k">SEAT DOSSIERS</span>
          </div>
          <div className="dossiers">
            {seats.map((s, i) => {
              const who = characterFor(s.playerId, i)
              const traits: Array<[string, number | null, string]> = [
                ['PLAYS HANDS', s.style.vpip, pct(s.style.vpip)],
                ['RAISES FIRST IN', s.style.pfr, pct(s.style.pfr)],
                ['TO SHOWDOWN', s.style.wtsd, pct(s.style.wtsd)],
              ]
              return (
                <article className="dossier" key={s.playerId} style={{ '--seat': who.color } as React.CSSProperties}>
                  <div className="dossier-top">
                    <span className="face big">
                      <MascotBadge playerId={s.playerId} index={i} size={48} />
                    </span>
                    <div>
                      <div className="name">{who.name}</div>
                      <div className="model">{s.models.map(shortModel).join(', ')}</div>
                      <div className="style">{styleLine(s)}</div>
                    </div>
                  </div>
                  <div className="traits">
                    {traits.map(([k, value, label]) => (
                      <div className="trait" key={k}>
                        <span className="k">{k}</span>
                        <span className="bar">
                          <span style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
                        </span>
                        <span className="v">{label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="dossier-foot">
                    <div>
                      <div className="k">SPENT</div>
                      <div className="v">{usd(s.costUsd)}</div>
                    </div>
                    <div>
                      <div className="k">PER DECISION</div>
                      <div className="v">{s.costPerDecisionUsd === null ? '–' : usd(s.costPerDecisionUsd)}</div>
                    </div>
                    <div>
                      <div className="k">LEANS</div>
                      <div className="v">{signedPts(s.biasPts)}</div>
                    </div>
                    <div>
                      <div className="k">FALLBACKS</div>
                      <div className="v">{s.fallbacks}</div>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </>
      )}

      <section className="models-method">
        <span className="k">HOW THESE ARE MEASURED</span>
        <p>
          Win rate is hands where a seat won or shared the main pot, of hands it was dealt into. Average error is the mean distance between the win chance a
          model stated before acting and the true chance worked out from every hole card, in percentage points, whichever way it leaned; &quot;leans&quot; is
          the same difference with its sign kept, so over and under-statements cancel and a positive number means the model talks itself up. Both count only
          decisions the model answered itself. True chances are enumerated exactly where that is cheap and estimated from 20,000 sampled boards where it is
          not. Average time is the wall clock per decision, and fallbacks count decisions where a seat was played check-or-fold after a timeout or an invalid
          answer. <Link href="/research">Read the method</Link>.
        </p>
      </section>
    </div>
  )
}
