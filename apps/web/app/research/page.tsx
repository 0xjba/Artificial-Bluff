import type { ModelsTable } from '@ab/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { ReportViewer } from '../../components/research/ReportViewer'
import { SeatStrip } from '../../components/research/SeatStrip'
import { WatchLive } from '../../components/research/WatchLive'
import { API_URL } from '../../lib/api'
import { usd } from '../../lib/format'
import { listReports } from '../../lib/reports'
import { NO_REPORT_PAGES, reportPages } from '../../lib/reportPages'
import { researchHeadline, researchMetrics } from '../../lib/research'
import styles from './research.module.css'

export const metadata: Metadata = { title: 'Research · artificialBluff' }

/** What every model has done across the finished live games (the live server does the arithmetic). */
async function loadModels(): Promise<ModelsTable | null> {
  try {
    const res = await fetch(`${API_URL}/api/models`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return null
    return (await res.json()) as ModelsTable
  } catch {
    return null
  }
}

const FINDINGS = [
  {
    h: 'Jev answers with a distribution',
    p: 'Jev returns a probability for every option it was offered — fold, call, raise to a size — so the log records not just what it did but how close the second choice was. The other seats answer with one action, a win chance and a confidence.',
  },
  {
    h: 'Chips stay in code',
    p: 'No model writes a number. The engine computes pots, stacks and side pots; models only choose from priced options, so a figure cannot be invented.',
  },
  {
    h: 'Spectators see what players cannot',
    p: 'True chances are computed from all hole cards for the broadcast only. No seat ever receives them, which is what makes the stated-against-true comparison fair.',
  },
]

export default async function Research() {
  await connection()
  const reports = listReports()
  const latest = reports[0]
  const table = await loadModels()
  const metrics = table && table.hands > 0 ? researchMetrics(table) : []
  const pages = latest ? reportPages(latest.report) : NO_REPORT_PAGES
  const base = latest ? `/research/${encodeURIComponent(latest.dir)}` : null
  const files = base
    ? [
        { href: `${base}/report.html`, label: 'Download report' },
        { href: `${base}/report.json`, label: 'JSON' },
        { href: `${base}/decisions.csv`, label: 'CSV' },
      ]
    : []

  return (
    <div className={`${styles['research-page']} research-light`}>
      <WatchLive />
      <section className={styles.intro}>
        <span className={styles.kicker}>RESEARCH</span>
        <h1>I&apos;m Jobin Ayathil.</h1>
        <p>
          I&apos;ve spent the last five years in developer relations, which mostly means sitting where a complicated system meets the people trying to use it,
          and fixing whatever makes them give up.
        </p>
        <p>
          Poker is the cheapest honest test I could find for a decision model. A hand forces a choice under hidden information, prices it in chips, and settles
          the argument within seconds — and unlike a benchmark, nobody can talk their way out of the result. Artificial Bluff seats five models at the same
          table, logs every decision with the probability the model claimed, and compares that against the true chance computed from all the cards. What comes
          out is not a leaderboard of cleverness but a record of which models know what they don&apos;t know.
        </p>
        <div className={styles.links}>
          <a href="https://github.com/0xjba">GitHub</a>
          <a href="https://www.linkedin.com/in/0xjba/">LinkedIn</a>
          <a href="mailto:jobinb6444@gmail.com">jobinb6444@gmail.com</a>
        </div>
      </section>

      <section className={styles['hands-say']}>
        <div className={styles.inner}>
          <div className={styles.lead}>
            <span className={styles.kicker}>WHAT THE HANDS SAY</span>
            <h2>{table && table.hands > 0 ? researchHeadline(table) : 'No games have finished yet.'}</h2>
            <p>
              {metrics.length
                ? "Every seat played the same hands under the same rules, and every decision was logged with the model's own stated win chance beside the true one."
                : 'Once the first live game finishes, this section fills in from its event log. The study below is the pre-registered version, where every deal is replayed in each seat.'}
            </p>
          </div>

          {metrics.length ? (
            <>
              <div className={styles.metrics}>
                {metrics.map((m) => (
                  <div key={m.what}>
                    <span className={styles.v}>{m.value}</span>
                    <span className={styles.k}>{m.what}</span>
                  </div>
                ))}
              </div>
              <SeatStrip table={table!} />
              <p className={styles.caveat}>
                Figures come from the event log of {table!.games} finished live {table!.games === 1 ? 'game' : 'games'} ({table!.hands} hands,{' '}
                {table!.seats.length} seats) and are demo scale, not a study result: the sample is small, blinds rise throughout, and the line-up can change
                between games. The report below is the pre-registered version, with the method, the equity computation and every limitation.
              </p>
            </>
          ) : null}

          <div className={styles.findings}>
            {FINDINGS.map((f) => (
              <div key={f.h}>
                <h3>{f.h}</h3>
                <p>{f.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.report}>
        <div className={styles.inner}>
          <div className={styles.lead}>
            <span className={styles.kicker}>TECHNICAL REPORT</span>
            <h2>Measuring stated confidence against true equity in AI-vs-AI Texas Hold&apos;em</h2>
            <p>
              {latest
                ? `A typed-readout decision model against general-purpose models under the same betting rules. ${latest.report.study.hands} hands, ${latest.report.players.length} seats, ${latest.report.study.decisions.toLocaleString('en-US')} logged decisions, ${usd(latest.report.study.costUsd)} spent. ${pages.length} pages.`
                : `A typed-readout decision model against general-purpose models under the same betting rules. The report is generated from the study's event log; ${pages.length} pages once the first study has run.`}
            </p>
          </div>

          <ReportViewer pages={pages} label={latest ? `${latest.report.study.id}.report` : 'artificial-bluff-report'} files={files} />

          <div className={styles.sections}>
            {pages.map((p) => (
              <div key={p.n}>
                <span className={styles.no}>{String(p.n).padStart(2, '0')}</span>
                <div>
                  <div className={styles.t}>{p.title}</div>
                  <div className={styles.p}>PAGE {p.n}</div>
                </div>
              </div>
            ))}
          </div>

          {reports.length > 1 ? (
            <p className={styles.caveat}>
              Earlier studies:{' '}
              {reports.slice(1).map((e, i) => (
                <span key={e.dir}>
                  {i > 0 ? ', ' : ''}
                  <a href={`/research/${encodeURIComponent(e.dir)}/report.html`}>{e.report.study.id}</a>
                </span>
              ))}
            </p>
          ) : null}
        </div>
      </section>

      <footer className={styles['research-footer']}>
        <div className={styles.inner}>
          <span className={styles.logo}>
            ARTIFICIAL<span>BLUFF</span>
          </span>
          <span className={styles.blurb}>A research benchmark that happens to be watchable. Chips are play money; models spend real tokens.</span>
          <span className={styles.links}>
            <Link href="/models">Models</Link>
            <Link href="/replays">Replays</Link>
            <Link href="/play">Run a table</Link>
          </span>
        </div>
      </footer>
    </div>
  )
}
