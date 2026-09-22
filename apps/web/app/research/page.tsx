import type { ModelsTable } from '@ab/server'
import type { StudyReport } from '@ab/study'
import type { Metadata } from 'next'
import { connection } from 'next/server'
import { ms, usd } from '../../lib/format'
import { listReports } from '../../lib/reports'
import { researchHeadline, researchMetrics } from '../../lib/research'
import { API_URL } from '../../lib/api'

export const revalidate = 0

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

export const metadata: Metadata = { title: 'Research · artificialBluff' }

const num = (x: number | null, d = 1) => (x === null || !Number.isFinite(x) ? '–' : x.toFixed(d))
const ci = (low: number | null, high: number | null) => (low === null || high === null || !Number.isFinite(low) || !Number.isFinite(high) ? '[–∞, ∞]' : `[${low.toFixed(1)}, ${high.toFixed(1)}]`)

function Study({ r, dir }: { r: StudyReport; dir: string }) {
  const name = (id: string) => {
    const p = r.players.find((x) => x.playerId === id)
    return `${id.toUpperCase()} · ${p?.model ?? ''}`
  }
  const mock = r.players.some((p) => p.kind === 'mock')
  const base = `/research/${encodeURIComponent(dir)}`
  return (
    <article className="study">
      <h2>{r.study.id}</h2>
      {mock ? <p className="warn">Mock seats: scripted stand-ins with simulated costs. Not research results.</p> : null}
      {r.study.status !== 'ended' ? <p className="warn">Interim: the study has not ended.</p> : null}
      <p className="muted">
        {r.study.hands} hands in {r.study.blocks} blocks · {r.study.endReason ?? r.study.status} · spent {usd(r.study.costUsd)} · pre-registration{' '}
        <code>{r.study.configHash.slice(0, 16)}…</code>
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th className="n">bb/100</th>
              <th className="n">95% CI</th>
              <th className="n">$ / 100 hands</th>
              <th className="n">Latency p50</th>
              <th className="n">Calibration (Brier, A)</th>
            </tr>
          </thead>
          <tbody>
            {r.results.map((res) => {
              const m = r.metrics.find((x) => x.playerId === res.playerId)
              const c = r.calibration.find((x) => x.playerId === res.playerId)
              return (
                <tr key={res.playerId} className={res.playerId === r.focusId ? 'jev' : ''}>
                  <td>{name(res.playerId)}</td>
                  <td className="n">{num(res.bb100.mean)}</td>
                  <td className="n">{ci(res.bb100.low, res.bb100.high)}</td>
                  <td className="n">{m?.costPer100HandsUsd === null || m === undefined ? '–' : usd(m.costPer100HandsUsd)}</td>
                  <td className="n">{ms(m?.latencyP50Ms ?? null)}</td>
                  <td className="n">{num(c?.winA.brier ?? null, 3)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <h3>Jev head to head</h3>
      <ul className="contrasts">
        {r.contrasts.map((c) => (
          <li key={c.otherId}>
            vs {name(c.otherId)}: <b>{num(c.diff.mean)}</b> bb/100 {ci(c.diff.low, c.diff.high)} ·{' '}
            {c.significant ? <b className="yes">significant</b> : <span className="muted">not significant</span>} (Holm p {c.pHolm === null ? '–' : c.pHolm < 0.0001 ? '<0.0001' : c.pHolm.toFixed(4)})
          </li>
        ))}
      </ul>
      <p>
        <a href={`${base}/report.html`}>Full report</a> · <a href={`${base}/decisions.csv`}>Every decision (CSV)</a> · <a href={`${base}/report.json`}>Numbers (JSON)</a>
      </p>
    </article>
  )
}

export default async function Research() {
  await connection()
  const reports = listReports()
  const table = await loadModels()
  const metrics = table && table.hands > 0 ? researchMetrics(table) : []
  return (
    <div className="research">
      <section className="intro">
        <span className="kicker">RESEARCH</span>
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
        <p className="links">
          <a href="https://github.com/0xjba">GitHub</a>
          <a href="https://www.linkedin.com/in/0xjba/">LinkedIn</a>
          <a href="mailto:jobinb6444@gmail.com">jobinb6444@gmail.com</a>
        </p>
      </section>

      <section className="hands-say">
        <span className="kicker">WHAT THE HANDS SAY</span>
        <h2>{table && table.hands > 0 ? researchHeadline(table) : 'No games have finished yet.'}</h2>
        {metrics.length ? (
          <>
            <p className="lede">
              Every seat played the same hands under the same rules, and every decision was logged with the model&apos;s own stated win chance beside the true
              one.
            </p>
            <div className="metrics">
              {metrics.map((m) => (
                <div key={m.what}>
                  <b>{m.value}</b>
                  <span>{m.what}</span>
                </div>
              ))}
            </div>
            <p className="caveat">
              These figures come from the event log of {table!.games} finished live {table!.games === 1 ? 'game' : 'games'} ({table!.hands} hands,{' '}
              {table!.seats.length} seats). They are demo scale, not a study result: the sample is small, blinds rise throughout, and the line-up can change
              between games. The study below is the pre-registered version, with each deal replayed in every seat.
            </p>
          </>
        ) : (
          <p className="lede">Once the first live game finishes, this section fills in from its event log. The study below is the pre-registered version.</p>
        )}
        <div className="findings">
          <div>
            <h3>Jev answers with a distribution</h3>
            <p>
              Jev returns a probability for every option it was offered — fold, call, raise to a size — so the log records not just what it did but how close
              the second choice was. The LLM seats answer with one action, a win chance and a confidence.
            </p>
          </div>
          <div>
            <h3>Chips stay in code</h3>
            <p>No model writes a number. The engine computes pots, stacks and side pots; models only choose from priced options, so a figure cannot be invented.</p>
          </div>
          <div>
            <h3>Spectators see what players cannot</h3>
            <p>
              True chances are computed from all hole cards for the broadcast only. No seat ever receives them, which is what makes the stated-against-true
              comparison fair.
            </p>
          </div>
        </div>
      </section>

      <section className="report-section">
        <span className="kicker">TECHNICAL REPORT</span>
        <h2>Measuring stated confidence against true equity in AI-vs-AI Texas Hold&apos;em</h2>
        {reports.length === 0 ? (
          <p className="lede">
            No study has been run yet. When one is, its report appears here with every number, the pre-registration hash, and the full decision log to download.
          </p>
        ) : (
          reports.map((e) => <Study key={e.dir} r={e.report} dir={e.dir} />)
        )}
      </section>
    </div>
  )
}
