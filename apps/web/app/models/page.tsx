import type { ModelsTable, SeatSummary } from '@ab/server'
import { characterFor } from '@ab/mascot'
import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { MascotBadge } from '../../components/MascotBadge'
import { API_URL } from '../../lib/api'
import { absPts, ms, pct, shortModel, signedChips, usd } from '../../lib/format'
import styles from './models.module.css'

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
    <div className={styles.models}>
      <header className={styles['models-head']}>
        <span className={styles.kicker}>THE TABLE</span>
        <h1>{seats.length ? `${seats.length} seats, ${new Set(seats.map((s) => s.model)).size} models, one set of rules` : 'The table'}</h1>
        <p>
          Each mascot is a permanent seat; the model behind it can change between games. Everything here is measured from the event log of every hand played —
          chips, decision time, spend, and how far each model&apos;s stated win chance sits from the true one.
        </p>
      </header>

      {!table ? (
        <p className={`${styles['models-empty']} warn`}>The live server isn&apos;t reachable, so there is nothing to show.</p>
      ) : seats.length === 0 ? (
        <p className={`${styles['models-empty']} muted`}>No game has finished yet. This page fills in once the first live game ends.</p>
      ) : (
        <>
          <div className={styles['models-scroll']}>
            <div className={styles['models-board']}>
              <div className={styles['row-head']}>
                <span>#</span>
                <span />
                <span>SEAT / MODEL</span>
                <span className={styles.r}>CHIPS WON</span>
                <span className={styles.r}>HANDS</span>
                <span>WIN RATE</span>
                <span className={styles.r}>AVG TIME</span>
                <span className={styles.r}>AVG ERROR</span>
              </div>
              {seats.map((s, i) => {
                const who = characterFor(s.playerId, i)
                return (
                  <div className={styles.row} key={s.playerId} style={{ '--seat': who.color } as React.CSSProperties}>
                    <span className={styles.rank}>{i + 1}</span>
                    <span className={styles.face}>
                      <MascotBadge playerId={s.playerId} index={i} size={28} />
                    </span>
                    <span className={styles.who}>
                      <span className={styles['who-top']}>
                        <b>{who.name}</b>
                        <span className={styles.chip}>{shortModel(s.model)}</span>
                        {s.models.length > 1 ? <span className={styles.chip}>+{s.models.length - 1} more</span> : null}
                      </span>
                      <span className={styles.style}>{styleLine(s)}</span>
                    </span>
                    {/* data-k labels each figure on a phone, where the row becomes a card and the head row goes. */}
                    <span data-k="CHIPS WON" className={`${styles.r} ${styles.chips} ${s.chipsWon < 0 ? 'down' : 'up'}`}>
                      {signedChips(s.chipsWon)}
                    </span>
                    <span data-k="HANDS" className={`${styles.r} ${styles.mono}`}>
                      {s.hands}
                    </span>
                    <span data-k="WIN RATE" className={styles.rate}>
                      <span className={styles.bar}>
                        <span style={{ width: `${Math.round((s.winRate ?? 0) * 100)}%` }} />
                      </span>
                      <span className={styles.mono}>{pct(s.winRate)}</span>
                    </span>
                    <span data-k="AVG TIME" className={`${styles.r} ${styles.mono}`}>
                      {ms(s.latencyMeanMs)}
                    </span>
                    <span data-k="AVG ERROR" className={`${styles.r} ${styles.mono}`}>
                      {absPts(s.errorPts)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className={styles['models-section']}>
            <span className={styles.k}>SEAT DOSSIERS</span>
          </div>
          <div className={styles.dossiers}>
            {seats.map((s, i) => {
              const who = characterFor(s.playerId, i)
              const traits: Array<[string, number | null, string]> = [
                ['PLAYS HANDS', s.style.vpip, pct(s.style.vpip)],
                ['RAISES FIRST IN', s.style.pfr, pct(s.style.pfr)],
                ['TO SHOWDOWN', s.style.wtsd, pct(s.style.wtsd)],
              ]
              return (
                <article className={styles.dossier} key={s.playerId} style={{ '--seat': who.color } as React.CSSProperties}>
                  <div className={styles['dossier-top']}>
                    <span className={`face ${styles.big}`}>
                      <MascotBadge playerId={s.playerId} index={i} size={48} />
                    </span>
                    <div>
                      <div className={styles.name}>{who.name}</div>
                      <div className={styles.model}>{s.models.map(shortModel).join(', ')}</div>
                      <div className={styles.style}>{styleLine(s)}</div>
                    </div>
                  </div>
                  <div className={styles.traits}>
                    {traits.map(([k, value, label]) => (
                      <div className={styles.trait} key={k}>
                        <span className={styles.k}>{k}</span>
                        <span className={styles.bar}>
                          <span style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
                        </span>
                        <span className={styles.v}>{label}</span>
                      </div>
                    ))}
                  </div>
                  <div className={styles['dossier-foot']}>
                    <div>
                      <div className={styles.k}>SPENT</div>
                      <div className={styles.v}>{usd(s.costUsd)}</div>
                    </div>
                    <div>
                      <div className={styles.k}>PER DECISION</div>
                      <div className={styles.v}>{s.costPerDecisionUsd === null ? '–' : usd(s.costPerDecisionUsd)}</div>
                    </div>
                    <div>
                      <div className={styles.k}>LEANS</div>
                      <div className={styles.v}>{signedPts(s.biasPts)}</div>
                    </div>
                    <div>
                      <div className={styles.k}>FALLBACKS</div>
                      <div className={styles.v}>{s.fallbacks}</div>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </>
      )}

      <section className={styles['models-method']}>
        <span className={styles.k}>HOW THESE ARE MEASURED</span>
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
