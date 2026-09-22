import type { Calibration } from '@ab/analysis'
import type { StudyReport } from './report'

/** Escapes text for HTML element content and attribute values. */
export function esc(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

const num = (x: number | null | undefined, digits = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '–' : x.toFixed(digits))
const pct = (x: number | null | undefined, digits = 1) => (x === null || x === undefined ? '–' : `${(x * 100).toFixed(digits)}%`)
/** Dollars with at least three significant digits (Jev's cost per decision is millionths of a dollar). */
const usd = (x: number | null | undefined) => {
  if (x === null || x === undefined) return '–'
  if (x === 0) return '$0'
  const digits = Math.min(12, Math.max(4, Math.ceil(-Math.log10(Math.abs(x))) + 2))
  return `$${x.toFixed(digits)}`
}
const pValue = (p: number | null) => (p === null ? '–' : p < 0.0001 ? '&lt;0.0001' : p.toFixed(4))
const ms = (x: number | null | undefined) => (x === null || x === undefined ? '–' : x >= 1000 ? `${(x / 1000).toFixed(2)} s` : x < 1 ? '<1 ms' : `${x.toFixed(0)} ms`)
const ci = (low: number, high: number) => (Number.isFinite(low) && Number.isFinite(high) ? `[${low.toFixed(1)}, ${high.toFixed(1)}]` : '[–∞, ∞]')

function table(head: string[], rows: string[][], numericFrom = 1): string {
  const th = head.map((h, i) => `<th${i >= numericFrom ? ' class="n"' : ''}>${esc(h)}</th>`).join('')
  const body = rows.map((r) => `<tr>${r.map((c, i) => `<td${i >= numericFrom ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`).join('')
  return `<div class="scroll"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`
}

/** Horizontal CI bars (mean dot, 95% t CI whiskers) around a zero line. */
function forestPlot(rows: Array<{ label: string; mean: number; low: number; high: number; highlight?: boolean }>, unit: string): string {
  const finite = rows.flatMap((r) => [r.low, r.high, r.mean]).filter(Number.isFinite)
  const span = Math.max(1, ...finite.map(Math.abs)) * 1.1
  const w = 640
  const left = 200
  const right = 20
  const rowH = 30
  const h = rows.length * rowH + 40
  const x = (v: number) => left + ((Math.max(-span, Math.min(span, v)) + span) / (2 * span)) * (w - left - right)
  const lines = rows
    .map((r, i) => {
      const y = 20 + i * rowH + rowH / 2
      const lo = Number.isFinite(r.low) ? x(r.low) : left
      const hi = Number.isFinite(r.high) ? x(r.high) : w - right
      const colour = r.highlight ? 'var(--brass)' : 'var(--cream)'
      return (
        `<text x="${left - 10}" y="${y + 4}" text-anchor="end" class="lbl">${esc(r.label)}</text>` +
        `<line x1="${lo}" x2="${hi}" y1="${y}" y2="${y}" stroke="${colour}" stroke-width="2"/>` +
        `<line x1="${lo}" x2="${lo}" y1="${y - 6}" y2="${y + 6}" stroke="${colour}" stroke-width="2"/>` +
        `<line x1="${hi}" x2="${hi}" y1="${y - 6}" y2="${y + 6}" stroke="${colour}" stroke-width="2"/>` +
        (Number.isFinite(r.mean) ? `<circle cx="${x(r.mean)}" cy="${y}" r="5" fill="${colour}"/>` : '')
      )
    })
    .join('')
  const axis =
    `<line x1="${x(0)}" x2="${x(0)}" y1="10" y2="${h - 25}" stroke="var(--muted)" stroke-dasharray="4 4"/>` +
    `<text x="${x(-span)}" y="${h - 8}" class="tick">${(-span).toFixed(0)}</text>` +
    `<text x="${x(0)}" y="${h - 8}" text-anchor="middle" class="tick">0 ${esc(unit)}</text>` +
    `<text x="${x(span)}" y="${h - 8}" text-anchor="end" class="tick">${span.toFixed(0)}</text>`
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(unit)} with 95% confidence intervals">${axis}${lines}</svg>`
}

/** Reliability diagram: mean stated probability vs mean outcome per bin, dot area by count. */
function reliability(cal: Calibration, title: string): string {
  const s = 200
  const pad = 28
  const inner = s - 2 * pad
  const px = (v: number) => pad + v * inner
  const py = (v: number) => s - pad - v * inner
  const bins = cal.bins.filter((b) => b.n > 0)
  const maxN = Math.max(1, ...bins.map((b) => b.n))
  const path = bins.map((b, i) => `${i ? 'L' : 'M'}${px(b.meanPredicted!).toFixed(1)},${py(b.meanObserved!).toFixed(1)}`).join('')
  const dots = bins
    .map((b) => `<circle cx="${px(b.meanPredicted!).toFixed(1)}" cy="${py(b.meanObserved!).toFixed(1)}" r="${(2 + 6 * Math.sqrt(b.n / maxN)).toFixed(1)}" fill="var(--brass)"><title>${b.n} decisions</title></circle>`)
    .join('')
  const body =
    `<rect x="${pad}" y="${pad}" width="${inner}" height="${inner}" fill="none" stroke="var(--rule)"/>` +
    `<line x1="${px(0)}" y1="${py(0)}" x2="${px(1)}" y2="${py(1)}" stroke="var(--muted)" stroke-dasharray="4 4"/>` +
    (path ? `<path d="${path}" fill="none" stroke="var(--brass)" stroke-width="1.5"/>` : '') +
    dots +
    `<text x="${px(0)}" y="${s - 14}" text-anchor="middle" class="tick">0</text><text x="${px(1)}" y="${s - 14}" text-anchor="middle" class="tick">1</text>` +
    `<text x="${pad - 6}" y="${py(1) + 4}" text-anchor="end" class="tick">1</text>` +
    `<text x="${px(0.5)}" y="${s - 6}" text-anchor="middle" class="tick">stated</text>` +
    `<text x="10" y="${py(0.5)}" text-anchor="middle" class="tick" transform="rotate(-90 10 ${py(0.5)})">outcome</text>`
  const stats = cal.n ? `n ${cal.n} · Brier ${num(cal.brier, 3)} · ECE ${num(cal.ece, 3)}` : 'no data'
  return `<figure class="rel"><svg viewBox="0 0 ${s} ${s}" role="img" aria-label="${esc(title)} reliability diagram">${body}</svg><figcaption><b>${esc(title)}</b><br>${esc(stats)}</figcaption></figure>`
}

const STYLE = `
:root{--felt:#0B2A24;--panel:#0E3029;--panel2:#123A32;--rule:#1F4A40;--cream:#F3EBDD;--muted:#9DB8AE;--brass:#E8B04A;--alert:#D9534F}
*{box-sizing:border-box}
body{margin:0;background:var(--felt);color:var(--cream);font:15px/1.5 Barlow,system-ui,sans-serif}
main{max-width:1080px;margin:0 auto;padding:24px 16px 64px}
h1,h2{font-family:"Barlow Condensed",Barlow,system-ui,sans-serif;letter-spacing:.02em}
h1{font-size:34px;margin:0 0 4px}h1 span{color:var(--brass)}
h2{font-size:22px;margin:40px 0 12px;border-bottom:1px solid var(--rule);padding-bottom:6px}
h3{font-size:16px;margin:24px 0 8px;color:var(--muted);font-weight:600}
.sub{color:var(--muted);margin:0 0 24px}
.meta{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}
.meta div{background:var(--panel);border:1px solid var(--rule);border-radius:6px;padding:8px 10px}
.meta dt{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em}.meta dd{margin:0;word-break:break-all}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;background:var(--panel);font-variant-numeric:tabular-nums}
th,td{padding:6px 10px;border-bottom:1px solid var(--rule);text-align:left;white-space:nowrap}
th{color:var(--muted);font-weight:600;font-size:13px;background:var(--panel2)}
td.n,th.n{text-align:right}
tr.focus td{color:var(--brass)}
svg{width:100%;height:auto;display:block;background:var(--panel);border:1px solid var(--rule);border-radius:6px}
svg .lbl{fill:var(--cream);font-size:13px}svg .tick{fill:var(--muted);font-size:11px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
figure.rel{margin:0}figcaption{font-size:13px;color:var(--muted);margin-top:4px}figcaption b{color:var(--cream)}
.yes{color:var(--brass);font-weight:600}.no{color:var(--muted)}
.mark{color:var(--brass)}
.banner{border:1px solid var(--alert);color:var(--cream);background:rgba(217,83,79,.12);border-radius:6px;padding:8px 12px;margin:0 0 16px}
.note{color:var(--muted)}ul.notes li{margin-bottom:6px}
td span.note{white-space:normal;display:inline-block;min-width:240px;text-align:left}
details{background:var(--panel);border:1px solid var(--rule);border-radius:6px;padding:8px 12px}
pre{white-space:pre-wrap;word-break:break-all;font-size:12px;color:var(--muted)}
`

/** The whole report as one self-contained HTML page (no scripts, no external requests). */
export function renderReportHtml(report: StudyReport): string {
  const label = new Map(report.players.map((p) => [p.playerId, `${p.playerId.toUpperCase()} · ${p.model}`]))
  // Charts have little room: seat plus the model without its vendor prefix, at most 26 characters.
  const short = new Map(
    report.players.map((p) => {
      const text = `${p.playerId.toUpperCase()} · ${p.model.split('/').at(-1)}`
      return [p.playerId, text.length > 26 ? `${text.slice(0, 25)}…` : text]
    }),
  )
  const name = (id: string) =>
    esc(label.get(id) ?? id) + (id === report.focusId ? ' <span class="mark" title="focus player">◆</span>' : '')
  const focusRow = (id: string) => (id === report.focusId ? ' class="focus"' : '')
  const rowsWithFocus = (html: string, ids: string[]) => {
    let i = 0
    return html.replace(/<tr>(?=<td)/g, () => `<tr${focusRow(ids[i++] ?? '')}>`)
  }
  const s = report.study
  const ids = report.players.map((p) => p.playerId)
  const mocks = report.players.filter((p) => p.kind === 'mock').map((p) => p.playerId.toUpperCase())
  const banners =
    (mocks.length ? `<p class="banner">Mock seats (${esc(mocks.join(', '))}): free stand-ins with scripted play and simulated costs. Not research results.</p>` : '') +
    (s.status !== 'ended' ? `<p class="banner">Interim report: the study has not ended (${esc(s.status)}). Numbers will change.</p>` : '')

  const meta = [
    ['Study', s.id],
    ['Status', `${s.status}${s.endReason ? ` (${s.endReason})` : ''}`],
    ['Analysed', `${s.analysedGroups} groups · ${s.blocks} blocks · ${s.hands} hands`],
    ['Decisions', String(s.decisions)],
    ['Spent (all hands)', usd(s.costUsd)],
    ['Pre-registration hash', s.configHash],
    ['Generated', report.generatedAt],
  ]
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
    .join('')

  const lineup = table(
    ['Seat', 'Kind', 'Configured model', 'Answered as'],
    report.players.map((p) => [esc(p.playerId.toUpperCase()), esc(p.kind), esc(p.model), esc(p.answeredModels.join(', ') || '–')]),
    4,
  )

  const results =
    forestPlot(
      report.results.map((r) => ({ label: short.get(r.playerId) ?? r.playerId, mean: r.bb100.mean, low: r.bb100.low, high: r.bb100.high, highlight: r.playerId === report.focusId })),
      'bb/100',
    ) +
    rowsWithFocus(
      table(
        ['Player', 'bb/100', '95% t CI', 'Bootstrap CI (sensitivity)', 'Hands'],
        report.results.map((r) => [name(r.playerId), num(r.bb100.mean), ci(r.bb100.low, r.bb100.high), ci(r.bb100Bootstrap.low, r.bb100Bootstrap.high), String(r.hands)]),
      ),
      report.results.map((r) => r.playerId),
    )

  const focusName = name(report.focusId)
  const contrasts =
    `<p class="note">${focusName} minus each opponent, paired by neighbour block. Significant means Holm-adjusted p &lt; 0.05 across all ${report.contrasts.length} comparisons.</p>` +
    forestPlot(
      report.contrasts.map((c) => ({ label: `vs ${short.get(c.otherId) ?? c.otherId}`, mean: c.diff.mean, low: c.diff.low, high: c.diff.high, highlight: c.significant })),
      'bb/100 difference',
    ) +
    table(
      ['Opponent', 'Difference (bb/100)', '95% t CI (unadjusted)', 'p', 'p (Holm)', 'Significant'],
      report.contrasts.map((c) => [
        name(c.otherId),
        num(c.diff.mean),
        ci(c.diff.low, c.diff.high),
        pValue(c.pValue),
        pValue(c.pHolm),
        c.significant ? '<span class="yes">yes</span>' : '<span class="no">no</span>',
      ]),
    )

  const cost = rowsWithFocus(
    table(
      ['Player', 'Decisions', '$ / decision', '$ / 100 hands', 'Total', 'Latency p50', 'Latency p95', 'Input tok', 'Output tok', 'Reasoning tok'],
      report.metrics.map((m) => [
        name(m.playerId),
        String(m.decisions),
        usd(m.costPerDecisionUsd),
        usd(m.costPer100HandsUsd),
        usd(m.costUsd),
        ms(m.latencyP50Ms),
        ms(m.latencyP95Ms),
        num(m.meanInputTokens, 0),
        num(m.meanOutputTokens, 0),
        num(m.meanReasoningTokens, 0),
      ]),
    ),
    ids,
  )

  /** One reliability chart per player with data, and a note naming those without. */
  const grid = (pick: (c: StudyReport['calibration'][number]) => Calibration, missing: string) => {
    const withData = report.calibration.filter((c) => pick(c).n > 0)
    const without = report.calibration.filter((c) => pick(c).n === 0).map((c) => label.get(c.playerId) ?? c.playerId)
    return (
      `<div class="grid">${withData.map((c) => reliability(pick(c), label.get(c.playerId) ?? c.playerId)).join('')}</div>` +
      (without.length ? `<p class="note">${esc(missing)}: ${esc(without.join(', '))}.</p>` : '')
    )
  }
  const calA = grid((c) => c.winA, 'No win probabilities stated')
  const calC = grid((c) => c.winC, 'No win probabilities stated')
  const ACTIONS = [
    ['fold', 'Folds: right if all-in equity was below the pot odds'],
    ['call', 'Calls: right if all-in equity met the pot odds'],
    ['check', "Checks: right if the player's stack didn't shrink afterwards"],
    ['raise', "Bets and raises: right if the player's stack didn't shrink afterwards"],
  ] as const
  const calAction = ACTIONS.map(([type, title]) => `<h3>${esc(title)}</h3>${grid((c) => c.actionByType[type], 'No confident actions of this type')}`).join('')
  const calTable = rowsWithFocus(
    table(
      ['Player', 'Win A: Brier', 'ECE', 'Win C: Brier', 'ECE', 'n', 'Confidence is'],
      report.calibration.map((c) => [
        name(c.playerId),
        num(c.winA.brier, 3),
        num(c.winA.ece, 3),
        num(c.winC.brier, 3),
        num(c.winC.ece, 3),
        String(c.winA.n),
        `<span class="note">${esc(c.confidenceSource)}</span>`,
      ]),
    ),
    ids,
  )
  const byType = table(
    ['Player', 'Fold', 'Check', 'Call', 'Raise'],
    report.calibration.map((c) => [
      name(c.playerId),
      ...(['fold', 'check', 'call', 'raise'] as const).map((t) => {
        const k = c.actionByType[t]
        return k.n ? `${num(k.brier, 3)} <span class="note">(n ${k.n})</span>` : '–'
      }),
    ]),
  )

  const fallbacks = table(
    ['Player', 'Model-output fallbacks', 'All fallbacks', 'Invalid output', 'Provider / network', 'Timeout', 'Auto-played', 'Needed a retry'],
    report.metrics.map((m) => [name(m.playerId), pct(m.modelFallbackRate, 2), pct(m.fallbackRate, 2), String(m.fallbacks.model), String(m.fallbacks.infra), String(m.fallbacks.timeout), String(m.fallbacks.auto), pct(m.retryRate, 2)]),
  )
  const style = table(
    ['Player', 'VPIP', 'PFR', 'Aggression (AF)', 'Went to showdown'],
    report.metrics.map((m) => [name(m.playerId), pct(m.style.vpip), pct(m.style.pfr), num(m.style.af, 2), pct(m.style.wtsd)]),
  )

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`artificialBluff study ${s.id}`)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>artificial<span>Bluff</span> · study ${esc(s.id)}</h1>
<p class="sub">Duplicate-format No-Limit Hold'em: Jev against LLMs on results, cost, latency and calibration. ◆ marks the focus player of the head-to-head comparisons.</p>
${banners}
<dl class="meta">${meta}</dl>
<h2>Line-up</h2>${lineup}
<h2>1. Results</h2>${results}
<h2>2. Head to head</h2>${contrasts}
<h2>3. Cost and latency</h2>${cost}
<h2>4. Win-probability calibration</h2>
<p class="note">Headline (A): stated win probability against the share of the main pot actually won. Dashed line: perfect calibration.</p>
${calA}
<p class="note">Second chart (C): against the expected main-pot share at the moment of the decision, from all hole cards (exact enumeration), which removes later actions and board luck.</p>
${calC}
${calTable}
<h2>5. Per-action calibration</h2>
<p class="note">Confidence against whether the chosen action was right, one action type at a time (the rules and base rates differ, so they are never pooled). Jev's confidence and the LLMs' are different quantities (see the table above): compare each player with itself.</p>
${calAction}
<p class="note">Brier score by action type:</p>
${byType}
<h2>6. Reliability</h2>${fallbacks}
<h2>7. Play style</h2>${style}
<h2>8. Method notes</h2>
<ul class="notes">${report.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
<h2>9. Pre-registration</h2>
<details><summary>Pre-registered configuration (hash ${esc(s.configHash)})</summary><pre>${esc(JSON.stringify(s.preregistration, null, 2))}</pre></details>
</main>
</body>
</html>
`
}
