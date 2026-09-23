import type { ModelSummary, ModelsTable } from '@ab/server'
import { characterFor } from '@ab/mascot'
import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { MascotBadge } from '../../components/MascotBadge'
import { API_URL } from '../../lib/api'
import { absPts, ms, pct, shortModel, usd } from '../../lib/format'
import styles from './models.module.css'

export const metadata: Metadata = { title: 'Models · artificialBluff' }

/** Below this many hands a model's figures are mostly noise, and the board says so. */
const FEW_HANDS = 100

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

/** Who makes a model, in a word: the provider for an API model, else what kind of player it is. */
function makerOf(m: Pick<ModelSummary, 'kind' | 'model'>): string {
  if (m.kind === 'jev') return 'TypeSafe'
  if (m.kind === 'bot') return 'rule bot'
  if (m.kind === 'mock') return 'mock'
  return m.model.includes('/') ? m.model.split('/')[0]! : 'model'
}

/** Chips won per hundred hands, in big blinds, signed: +12.4 bb. */
const bb100 = (v: number | null) => (v === null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} bb`)

/** Which way a model's stated chances lean, in words that fit under the figure. */
function lean(biasPts: number | null): string | null {
  if (biasPts === null) return null
  if (Math.abs(biasPts) < 2) return 'no lean'
  return `${biasPts > 0 ? 'talks itself up' : 'talks itself down'} ${Math.abs(biasPts).toFixed(0)}`
}

/** How a model plays, in one line, from its measured style. */
function styleLine(m: ModelSummary): string {
  const parts: string[] = []
  if (m.style.vpip !== null) parts.push(`plays ${pct(m.style.vpip)} of hands`)
  if (m.style.pfr !== null) parts.push(`raises first ${pct(m.style.pfr)}`)
  if (m.style.wtsd !== null) parts.push(`to showdown ${pct(m.style.wtsd)}`)
  return parts.join(' · ')
}

export default async function Models() {
  await connection()
  const table = await loadModels()
  const models = table?.models ?? []

  return (
    <div className={styles.models}>
      <header className={styles.head}>
        <span className={styles.kicker}>MODELS</span>
        <h1>Every model that has played at the table</h1>
        {table && models.length ? (
          <p className={styles.counts}>
            {models.length} {models.length === 1 ? 'model' : 'models'} · {table.games} {table.games === 1 ? 'game' : 'games'} ·{' '}
            {table.hands.toLocaleString('en-US')} hands, every figure from the event log
          </p>
        ) : null}
      </header>

      {!table ? (
        <p className={`${styles.empty} warn`}>The live server isn&apos;t reachable, so there is nothing to show.</p>
      ) : models.length === 0 ? (
        <p className={`${styles.empty} muted`}>No game has finished yet. This page fills in once the first live game ends.</p>
      ) : (
        <div className={styles.board}>
          <div className={styles['row-head']}>
            <span>#</span>
            <span>MODEL</span>
            <span className={styles.r}>HANDS</span>
            <span className={styles.r} title="Chips won per hundred hands, in big blinds, so stakes and game length don't skew it">
              WON / 100 HANDS
            </span>
            <span className={styles.r} title="How far the win chance it stated sits from the real one, on average, in percentage points">
              OFF THE TRUTH
            </span>
            <span className={styles.r}>TIME / MOVE</span>
            <span className={styles.r}>COST / MOVE</span>
          </div>
          {models.map((m, i) => (
            <div className={styles.row} key={m.model}>
              <span className={styles.rank}>{i + 1}</span>
              <span className={styles.who}>
                <span className={styles['who-top']}>
                  <b>{shortModel(m.model)}</b>
                  <span className={styles.maker}>{makerOf(m)}</span>
                </span>
                {/* The seats it has sat in: the characters are the house, the models move between them. */}
                <span className={styles.seats}>
                  <span>as</span>
                  {/* By character: games from before a seat was renamed carry its old id. */}
                  {[...new Set(m.seats.map((id) => characterFor(id).id))].map((id) => (
                    <span className={styles.seat} key={id}>
                      <MascotBadge playerId={id} index={0} size={16} />
                      {characterFor(id).name}
                    </span>
                  ))}
                </span>
                {styleLine(m) ? <span className={styles.style}>{styleLine(m)}</span> : null}
              </span>
              {/* data-k labels each figure on a phone, where the row becomes a card and the head row goes. */}
              <span data-k="HANDS" className={`${styles.r} ${styles.mono}`}>
                {m.hands.toLocaleString('en-US')}
                {m.hands < FEW_HANDS ? <small>few hands</small> : null}
              </span>
              <span data-k="WON / 100 HANDS" className={`${styles.r} ${styles.mono} ${m.bb100 === null ? '' : m.bb100 < 0 ? styles.down : styles.up}`}>
                {bb100(m.bb100)}
              </span>
              <span data-k="OFF THE TRUTH" className={`${styles.r} ${styles.mono}`}>
                {absPts(m.errorPts)}
                {lean(m.biasPts) ? <small>{lean(m.biasPts)}</small> : null}
              </span>
              <span data-k="TIME / MOVE" className={`${styles.r} ${styles.mono}`}>
                {ms(m.latencyMeanMs)}
              </span>
              <span data-k="COST / MOVE" className={`${styles.r} ${styles.mono}`}>
                {m.costPerDecisionUsd === null ? '–' : usd(m.costPerDecisionUsd)}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className={styles.method}>
        Won / 100 hands is chips won in big blinds per hundred hands, so models that played different numbers of hands at different stakes still compare. Off
        the truth is the average distance between the win chance a model stated before it acted and its real chance with every card known, counting only moves
        it answered itself. <Link href="/research">How it&apos;s measured →</Link>
      </p>
    </div>
  )
}
