import type { StudyReport } from '@ab/study'
import type { ReportPage } from '../components/research/ReportViewer'
import { ms, usd } from './format'

const num = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '–' : x.toFixed(d))
const ci = (low: number | null, high: number | null) => (low === null || high === null || !Number.isFinite(low) || !Number.isFinite(high) ? '[–, –]' : `[${low.toFixed(1)}, ${high.toFixed(1)}]`)
const p = (x: number | null) => (x === null ? '–' : x < 0.0001 ? '<0.0001' : x.toFixed(4))

/** The pages the reader shows before any study has been run. */
export const NO_REPORT_PAGES: ReportPage[] = [
  {
    n: 1,
    title: 'No study has been run yet',
    body: (
      <>
        <p>
          The live table plays for the audience; the study is the measured version of the same game. When the first study finishes, its report appears here:
          every number, the pre-registration hash it was fixed against, and the full decision log to download.
        </p>
        <p>The method is set in advance and is summarised on this page. Nothing below is filled in by hand.</p>
      </>
    ),
  },
  {
    n: 2,
    title: 'What it will measure',
    body: (
      <ul>
        <li>Chips won per 100 hands, in big blinds, with a 95% confidence interval.</li>
        <li>Jev against each other seat, paired by deal, with Holm-corrected p-values.</li>
        <li>Stated win chance against the true chance from every hole card: Brier score and calibration error.</li>
        <li>Cost per decision, decision time, and every hand a seat had to be auto-played.</li>
      </ul>
    ),
  },
]

/** The report as pages of a reader: one subject per page, all of it from the study's own numbers. */
export function reportPages(r: StudyReport): ReportPage[] {
  const name = (id: string) => {
    const player = r.players.find((x) => x.playerId === id)
    return `${id.toUpperCase()}${player ? ` · ${player.model}` : ''}`
  }
  const mock = r.players.some((x) => x.kind === 'mock')
  const pages: Array<Omit<ReportPage, 'n'>> = [
    {
      title: 'Method and table rules',
      body: (
        <>
          {mock ? <p className="flag">Mock seats: scripted stand-ins with simulated costs. Not research results.</p> : null}
          {r.study.status !== 'ended' ? <p className="flag">Interim: this study has not ended.</p> : null}
          <p>
            Duplicate format: every deal is replayed with each seat in each position, so the cards cancel out and what remains is the decisions. The analysis
            was fixed before the run and hashed; the study ran until the stopping rule was met or the budget was spent.
          </p>
          <dl>
            <div>
              <dt>Study</dt>
              <dd>{r.study.id}</dd>
            </div>
            <div>
              <dt>Hands</dt>
              <dd>
                {r.study.hands} in {r.study.blocks} blocks
              </dd>
            </div>
            <div>
              <dt>Decisions</dt>
              <dd>{r.study.decisions.toLocaleString('en-US')}</dd>
            </div>
            <div>
              <dt>Ended</dt>
              <dd>{r.study.endReason ?? r.study.status}</dd>
            </div>
            <div>
              <dt>Spent</dt>
              <dd>{usd(r.study.costUsd)}</dd>
            </div>
            <div>
              <dt>Pre-registration</dt>
              <dd className="mono">{r.study.configHash.slice(0, 24)}…</dd>
            </div>
          </dl>
        </>
      ),
    },
    {
      title: 'The line-up',
      body: (
        <>
          <p>Each seat was played by one model throughout. The focus of the analysis is {name(r.focusId)}.</p>
          <ul>
            {r.players.map((x) => (
              <li key={x.playerId}>
                <b>{x.playerId.toUpperCase()}</b> · {x.model}
                {x.answeredModels.length > 1 ? ` (answered by ${x.answeredModels.join(', ')})` : ''}
              </li>
            ))}
          </ul>
        </>
      ),
    },
    {
      title: 'Results: chips won',
      body: (
        <table>
          <thead>
            <tr>
              <th>Seat</th>
              <th className="n">bb/100</th>
              <th className="n">95% CI</th>
              <th className="n">Hands</th>
            </tr>
          </thead>
          <tbody>
            {r.results.map((res) => (
              <tr key={res.playerId} className={res.playerId === r.focusId ? 'focus' : ''}>
                <td>{name(res.playerId)}</td>
                <td className="n">{num(res.bb100.mean)}</td>
                <td className="n">{ci(res.bb100.low, res.bb100.high)}</td>
                <td className="n">{res.hands}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    },
    {
      title: 'Jev against each seat',
      body: (
        <>
          <p>Paired by deal, so the same cards are on both sides. Holm-corrected across the family of contrasts.</p>
          <table>
            <thead>
              <tr>
                <th>Against</th>
                <th className="n">Difference</th>
                <th className="n">95% CI</th>
                <th className="n">Holm p</th>
              </tr>
            </thead>
            <tbody>
              {r.contrasts.map((c) => (
                <tr key={c.otherId} className={c.significant ? 'focus' : ''}>
                  <td>{name(c.otherId)}</td>
                  <td className="n">{num(c.diff.mean)}</td>
                  <td className="n">{ci(c.diff.low, c.diff.high)}</td>
                  <td className="n">{p(c.pHolm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ),
    },
    {
      title: 'Stated confidence against outcome',
      body: (
        <>
          <p>
            Each seat states its chance of winning before it acts. Brier is the mean squared error of those statements against the outcome (lower is better);
            the calibration error is how far the stated chances sit from the rate they actually came in at.
          </p>
          <table>
            <thead>
              <tr>
                <th>Seat</th>
                <th className="n">Brier (won)</th>
                <th className="n">Brier (equity)</th>
                <th className="n">Cal. error</th>
                <th className="n">Decisions</th>
              </tr>
            </thead>
            <tbody>
              {r.calibration.map((c) => (
                <tr key={c.playerId} className={c.playerId === r.focusId ? 'focus' : ''}>
                  <td>{name(c.playerId)}</td>
                  <td className="n">{num(c.winA.brier, 3)}</td>
                  <td className="n">{num(c.winC.brier, 3)}</td>
                  <td className="n">{num(c.winC.ece, 3)}</td>
                  <td className="n">{c.winA.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ),
    },
    {
      title: 'Cost, speed and reliability',
      body: (
        <table>
          <thead>
            <tr>
              <th>Seat</th>
              <th className="n">$ / 100 hands</th>
              <th className="n">Latency p50</th>
              <th className="n">Fallbacks</th>
            </tr>
          </thead>
          <tbody>
            {r.metrics.map((m) => (
              <tr key={m.playerId} className={m.playerId === r.focusId ? 'focus' : ''}>
                <td>{name(m.playerId)}</td>
                <td className="n">{m.costPer100HandsUsd === null ? '–' : usd(m.costPer100HandsUsd)}</td>
                <td className="n">{ms(m.latencyP50Ms)}</td>
                <td className="n">{Object.values(m.fallbacks).reduce((sum, n) => sum + n, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    },
    {
      title: 'Limitations',
      body: (
        <ul>
          {r.notes.length ? r.notes.map((note) => <li key={note}>{note}</li>) : <li>None recorded for this study.</li>}
        </ul>
      ),
    },
  ]
  return pages.map((page, i) => ({ ...page, n: i + 1 }))
}
