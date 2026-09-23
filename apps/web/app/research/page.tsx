import { headline, paperFacts, type PaperFacts } from '@ab/study/paper'
import type { Metadata } from 'next'
import { connection } from 'next/server'
import { PaperViewer } from '../../components/research/PaperViewer'
import { WatchLive } from '../../components/research/WatchLive'
import { researchCaveat, researchTiles } from '../../lib/research'
import { latestStudy, studyKind, listReports, paperPages, readDecisions, type ReportEntry } from '../../lib/reports'
import styles from './research.module.css'

export const metadata: Metadata = { title: 'Research · artificialBluff' }

/** How the design choices hold whatever the numbers turn out to be: the three findings under the figures. */
const FINDINGS = [
  {
    h: 'A distribution, not a sentence',
    p: 'Jev answers every decision with a probability for each option it was offered, so the log records not just what it chose but how close the next choice was. The language models write one option, a win chance and a line of reasoning.',
  },
  {
    h: 'Numbers stay in code',
    p: 'No model writes a figure. The engine prices every option, settles every pot and side pot, and hands the models a menu to choose from, so a chip amount can never be invented or mistyped.',
  },
  {
    h: 'The truth is computed, not judged',
    p: 'The true chance at each decision is worked out from every hole card at the table, which no player ever sees. Nobody grades the answers: the claim and the arithmetic sit side by side.',
  },
]

/** What the study measures, named before there are numbers for any of it. */
const MEASURES = [
  'Time to a decision',
  'Cost per decision',
  'How far a stated win chance sits from the true odds',
  'Which way each model leans',
  'Folds and calls against the pot odds',
  'Answers that fell back to check-or-fold',
  'Chips per 100 hands, with intervals',
  'Every decision re-scored from all the cards',
]

const TITLE = 'Stated confidence against true equity in AI-vs-AI Texas Hold’em'

/** A study's report, its decisions reduced to the facts the page and the paper share, and its paper. */
function evidence(entry: ReportEntry): { facts: PaperFacts; pages: number; base: string } {
  return {
    facts: paperFacts(entry.report, readDecisions(entry.dir)),
    pages: paperPages(entry.dir),
    base: `/research/${encodeURIComponent(entry.dir)}`,
  }
}

export default async function Research({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  await connection()
  const { preview } = await searchParams
  const reports = listReports()
  const study = latestStudy(reports)
  // Development only: before a real study exists, the page can be seen on a pilot or a rehearsal, clearly marked.
  const previewKind = preview === 'pilot' || preview === 'rehearsal' ? preview : null
  const rehearsal = !study && previewKind && process.env.NODE_ENV !== 'production' ? (reports.find((e) => studyKind(e.report) === previewKind) ?? null) : null
  const shown = study ?? rehearsal
  const ev = shown ? evidence(shown) : null
  const f = ev?.facts
  const others = f?.others.map((o) => o.label) ?? []
  const when = shown ? new Date(shown.report.generatedAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : null

  return (
    <div className={`${styles['research-page']} research-light`}>
      <WatchLive />
      {rehearsal ? (
        <div className={styles.rehearsal}>
          {previewKind === 'pilot'
            ? `Pilot run of ${rehearsal.report.study.hands} hands on real models: a check of the pipeline, too few hands for results.`
            : 'Rehearsal on mock players: a preview of the layout, not results.'}
        </div>
      ) : null}

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

      <section className={styles.measured}>
        <div className={styles.inner}>
          {f ? (
            <>
              <div className={styles.lead}>
                <span className={styles.kicker}>WHAT THE MEASUREMENTS SAY</span>
                <h2>{headline(f)}</h2>
                <p>
                  {f.focus.kind === 'jev' ? 'Jev, TypeSafe’s typed-readout model,' : f.focus.label} played the same {f.study.hands.toLocaleString('en-US')} hands as{' '}
                  {others.length > 1 ? `${others.slice(0, -1).join(', ')} and ${others.at(-1)}` : others[0]}, dealt so that every model plays every hand from every
                  seat, and every decision was scored against the true odds worked out from all the cards.
                </p>
              </div>
              <div className={styles.tiles}>
                {researchTiles(f).map((t) => (
                  <div className={styles.tile} key={t.what}>
                    <span className={styles.v}>{t.value}</span>
                    <span className={styles.k}>{t.what}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className={styles.lead}>
              <span className={styles.kicker}>WHAT WE&apos;RE MEASURING</span>
              <h2>The first study is being run.</h2>
              <p>
                Jev, TypeSafe&apos;s typed-readout model, against four frontier language models, on duplicate deals so that luck in the cards cancels out, under a
                protocol fixed before the first hand. The figures, the paper and its data appear here when it finishes. Until then there is nothing to report, so
                nothing is shown.
              </p>
              <ul className={styles.measures}>
                {MEASURES.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          <div className={styles.findings}>
            {FINDINGS.map((x) => (
              <div key={x.h}>
                <h3>{x.h}</h3>
                <p>{x.p}</p>
              </div>
            ))}
          </div>

          {f ? <p className={styles.caveat}>{researchCaveat(f)}</p> : null}
        </div>
      </section>

      {ev && ev.pages > 0 ? (
        <section className={styles.report}>
          <div className={styles.inner}>
            <div className={styles['report-lead']}>
              <span className={styles.kicker}>TECHNICAL REPORT</span>
              <h2>{TITLE}</h2>
              <p>
                A typed-readout decision model compared with general-purpose language models. Jobin Ayathil, {when}. {ev.pages} pages.
              </p>
            </div>
            <PaperViewer src={`${ev.base}/paper.pdf`} download={`${ev.base}/paper.pdf`} pages={ev.pages} />
            <p className={styles.data}>
              The data behind every figure: <a href={`${ev.base}/decisions.csv`}>every decision (CSV)</a> · <a href={`${ev.base}/report.json`}>every number (JSON)</a>
            </p>
          </div>
        </section>
      ) : null}
    </div>
  )
}
