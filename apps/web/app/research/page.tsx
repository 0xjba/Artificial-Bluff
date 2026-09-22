import type { StudyReport } from '@ab/study'
import { connection } from 'next/server'
import { ms, usd } from '../../lib/format'
import { listReports } from '../../lib/reports'

export const metadata = { title: 'Research · artificialBluff' }

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
  return (
    <section className="page">
      <h1>Research</h1>
      <p className="lede">
        A pre-registered, duplicate-format study: every deal is replayed with each player in each seat, so the cards cancel out and what remains is
        decision quality. We compare TypeSafe’s Jev with frontier LLMs on results, cost, latency and how well each one knows its own chances.
      </p>
      <ul className="method">
        <li>Everyone sees the same facts, computed by code: no equity hints.</li>
        <li>Results in big blinds per 100 hands with 95% confidence intervals; pairwise claims only from the pre-registered, Holm-corrected comparisons.</li>
        <li>Calibration: stated win probability against the share of the pot actually won, and against the true odds at the moment of the decision.</li>
        <li>Costs as billed; latency as measured per decision. Download everything below.</li>
      </ul>
      {reports.length === 0 ? <p className="muted">No study reports yet. Run a study, then `pnpm study report`.</p> : reports.map((e) => <Study key={e.dir} r={e.report} dir={e.dir} />)}
    </section>
  )
}
