import type { Calibration, ScoredDecision } from '@ab/analysis'

export type { ScoredDecision }
import { esc } from './html'
import type { StudyReport } from './report'

/**
 * The technical report as a paper: an academic two-column document, printed to PDF, written from a
 * study's own numbers. Every sentence that states a result is built from a computed fact, and a claim
 * goes in only when the fact holds (a chip difference is stated only when the pre-registered paired
 * test with Holm's correction says so). Nothing here is written by hand about a particular run.
 */

/** A number, or null when there isn't one (report.json stores NaN and infinities as null). */
const fin = (x: number | null | undefined): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
/** Population standard deviation. */
const sd = (xs: readonly number[]): number | null => {
  const m = mean(xs)
  return m === null ? null : Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length)
}

export interface ModelFacts {
  playerId: string
  model: string
  kind: string
  /** How the paper names it: the model, not the seat (seats are the house, models move between them). */
  label: string
  focus: boolean
  /** Decisions the model made itself (fallbacks are the engine's check-or-fold, not the model's judgement). */
  answered: number
  latencyP50Ms: number | null
  latencyP95Ms: number | null
  costPerDecisionUsd: number | null
  fallbackRate: number | null
  /** Mean |stated win chance − true chance from every hole card|, in percentage points. */
  offTruthPts: number | null
  /** The same with its sign kept: positive means the model talks itself up. */
  biasPts: number | null
  brierC: number | null
  eceC: number | null
  /** Against the share of the main pot actually won: the pre-registered headline outcome (A). */
  brierA: number | null
  eceA: number | null
  /** Standard deviation of the stated win chances, and of the true chances in the same spots (points). */
  spreadPts: number | null
  truthSpreadPts: number | null
  calibrationC: Calibration | null
  /** Folds and calls are scored against pot odds with the true equity (the pre-registered rule). */
  foldRight: { n: number; rate: number | null }
  callRight: { n: number; rate: number | null }
  bb100: { mean: number | null; low: number | null; high: number | null }
  /** Hosts that served the model's calls (OpenRouter's routing), largest share first; empty when none said. */
  hosts: Array<{ name: string; share: number }>
  /** Focus minus this model, from the pre-registered paired contrast (null for the focus itself). */
  vsFocus: { mean: number | null; low: number | null; high: number | null; pHolm: number | null; significant: boolean } | null
}

export interface PaperFacts {
  study: StudyReport['study']
  generatedAt: string
  focus: ModelFacts
  others: ModelFacts[]
  decisions: number
  speed: { fastestOther: ModelFacts | null; slowestOther: ModelFacts | null; timesFasterThanFastest: number | null; timesFasterThanSlowest: number | null }
  cost: { cheapestOther: ModelFacts | null; dearestOther: ModelFacts | null; timesCheaperThanCheapest: number | null; timesCheaperThanDearest: number | null }
  truth: { focusBest: boolean; bestOther: ModelFacts | null; worstOther: ModelFacts | null }
  /** Models the focus won significantly more chips than, and ones that won significantly more than it. */
  significantChipWins: ModelFacts[]
  significantChipLosses: ModelFacts[]
  /**
   * The focus's own moves where the pre-registered move rule played something other than TypeSafe's
   * pick, by the kind of move it played instead; null when the log doesn't record the pick.
   */
  moveRule: { moves: number; changed: number; toRaise: number; toCall: number; toFold: number } | null
  /** The pre-registered headline outcome (A): who had the lowest Brier score, and where the focus ranked. */
  outcome: { best: ModelFacts | null; focusRank: number | null; of: number }
  /** Against the true chance (C): whether the focus had the lowest ECE, and the best other model on it. */
  calibration: { focusBestEce: boolean; bestOtherEce: ModelFacts | null }
}

const moveKind = (id: string) => (id === 'fold' ? 'fold' : id === 'check' || id === 'call' ? 'call' : 'raise')

/** The model's name as a reader knows it: Jev by name, an API model by its id without the provider. */
export function modelLabel(kind: string, model: string): string {
  if (kind === 'jev') return `Jev (${model})`
  const tail = model.split('/').slice(kind === 'mock' ? 0 : 1).join('/')
  return tail || model
}

const by = <T>(xs: readonly T[], key: (x: T) => number | null, dir: 1 | -1): T | null =>
  xs.filter((x) => key(x) !== null).sort((a, b) => dir * (key(a)! - key(b)!))[0] ?? null

/** Everything the paper states, computed once from the report and the scored decisions. */
export function paperFacts(report: StudyReport, decisions: readonly ScoredDecision[]): PaperFacts {
  const facts = report.players.map((p): ModelFacts => {
    const m = report.metrics.find((x) => x.playerId === p.playerId)
    const cal = report.calibration.find((x) => x.playerId === p.playerId)
    const r = report.results.find((x) => x.playerId === p.playerId)
    const c = report.contrasts.find((x) => x.otherId === p.playerId)
    const own = decisions.filter((d) => d.playerId === p.playerId && !d.fallback)
    const stated = own.filter((d) => d.winProbability !== null)
    const scored = (type: string) => {
      const xs = own.filter((d) => d.actionType === type)
      return { n: xs.length, rate: mean(xs.map((d) => d.actionGood)) }
    }
    const pts = (f: (d: ScoredDecision) => number) => {
      const v = mean(stated.map(f))
      return v === null ? null : v * 100
    }
    const served = decisions.filter((d) => d.playerId === p.playerId && d.provider)
    const counts = new Map<string, number>()
    for (const d of served) counts.set(d.provider!, (counts.get(d.provider!) ?? 0) + 1)
    const hosts = [...counts].map(([name, n]) => ({ name, share: n / served.length })).sort((a, b) => b.share - a.share || a.name.localeCompare(b.name))
    return {
      hosts,
      playerId: p.playerId,
      model: p.model,
      kind: p.kind,
      label: modelLabel(p.kind, p.model),
      focus: p.playerId === report.focusId,
      answered: own.length,
      latencyP50Ms: fin(m?.latencyP50Ms),
      latencyP95Ms: fin(m?.latencyP95Ms),
      costPerDecisionUsd: fin(m?.costPerDecisionUsd),
      fallbackRate: fin(m?.fallbackRate),
      offTruthPts: pts((d) => Math.abs(d.winProbability! - d.expectedShare)),
      biasPts: pts((d) => d.winProbability! - d.expectedShare),
      brierC: fin(cal?.winC.brier),
      eceC: fin(cal?.winC.ece),
      brierA: fin(cal?.winA.brier),
      eceA: fin(cal?.winA.ece),
      spreadPts: stated.length ? sd(stated.map((d) => d.winProbability! * 100)) : null,
      truthSpreadPts: stated.length ? sd(stated.map((d) => d.expectedShare * 100)) : null,
      calibrationC: cal?.winC ?? null,
      foldRight: scored('fold'),
      callRight: scored('call'),
      bb100: { mean: fin(r?.bb100.mean), low: fin(r?.bb100.low), high: fin(r?.bb100.high) },
      vsFocus: c ? { mean: fin(c.diff.mean), low: fin(c.diff.low), high: fin(c.diff.high), pHolm: fin(c.pHolm), significant: c.significant } : null,
    }
  })
  const focus = facts.find((f) => f.focus) ?? facts[0]!
  const others = facts.filter((f) => f !== focus)
  const ratio = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 ? a / b : null)
  const fastestOther = by(others, (f) => f.latencyP50Ms, 1)
  const slowestOther = by(others, (f) => f.latencyP50Ms, -1)
  const cheapestOther = by(others, (f) => f.costPerDecisionUsd, 1)
  const dearestOther = by(others, (f) => f.costPerDecisionUsd, -1)
  const bestOther = by(others, (f) => f.offTruthPts, 1)
  const worstOther = by(others, (f) => f.offTruthPts, -1)
  return {
    study: report.study,
    generatedAt: report.generatedAt,
    focus,
    others,
    decisions: report.study.decisions,
    speed: {
      fastestOther,
      slowestOther,
      timesFasterThanFastest: ratio(fastestOther?.latencyP50Ms ?? null, focus.latencyP50Ms),
      timesFasterThanSlowest: ratio(slowestOther?.latencyP50Ms ?? null, focus.latencyP50Ms),
    },
    cost: {
      cheapestOther,
      dearestOther,
      timesCheaperThanCheapest: ratio(cheapestOther?.costPerDecisionUsd ?? null, focus.costPerDecisionUsd),
      timesCheaperThanDearest: ratio(dearestOther?.costPerDecisionUsd ?? null, focus.costPerDecisionUsd),
    },
    truth: { focusBest: focus.offTruthPts !== null && others.every((o) => o.offTruthPts === null || focus.offTruthPts! < o.offTruthPts), bestOther, worstOther },
    significantChipWins: others.filter((o) => o.vsFocus?.significant && (o.vsFocus.mean ?? 0) > 0),
    significantChipLosses: others.filter((o) => o.vsFocus?.significant && (o.vsFocus.mean ?? 0) < 0),
    moveRule: moveRuleOf(decisions.filter((d) => d.playerId === focus.playerId && !d.fallback)),
    outcome: (() => {
      const ranked = facts.filter((x) => x.brierA !== null).sort((a, b) => a.brierA! - b.brierA!)
      const at = ranked.indexOf(focus)
      return { best: ranked[0] ?? null, focusRank: at < 0 ? null : at + 1, of: ranked.length }
    })(),
    calibration: (() => {
      const bestOtherEce = by(others, (x) => x.eceC, 1)
      return { focusBestEce: focus.eceC !== null && others.every((o) => o.eceC === null || focus.eceC! < o.eceC), bestOtherEce }
    })(),
  }
}

function moveRuleOf(own: readonly ScoredDecision[]): PaperFacts['moveRule'] {
  const picked = own.filter((d) => d.jevChoice)
  if (picked.length === 0) return null
  const changed = picked.filter((d) => d.jevChoice !== d.optionId)
  const to = (k: string) => changed.filter((d) => moveKind(d.optionId) === k).length
  return { moves: picked.length, changed: changed.length, toRaise: to('raise'), toCall: to('call'), toFold: to('fold') }
}

/** A ratio as the paper writes it: 20×, 6.8×. */
export const times = (x: number) => (x >= 10 ? `${Math.round(x)}×` : `${x.toFixed(1)}×`)

/** A ratio only counts as a claim when it is a real difference, not noise around 1. */
const CLAIM_RATIO = 1.5

/**
 * The one-line finding, from what held. Each part is included only when its fact holds against every
 * model the focus played: faster than the fastest, cheaper than the cheapest, closer than the closest.
 */
export function headline(f: PaperFacts): string {
  const parts: string[] = []
  const faster = f.speed.timesFasterThanFastest
  if (faster !== null && faster >= CLAIM_RATIO) parts.push(`${times(faster)} faster`)
  const cheaper = f.cost.timesCheaperThanCheapest
  if (cheaper !== null && cheaper >= CLAIM_RATIO) parts.push(`${times(cheaper)} cheaper`)
  if (f.truth.focusBest) parts.push('closer to the true odds than every model it played')
  if (!parts.length) return 'A typed-readout model and general-purpose models, measured on the same cards.'
  const text = parts.length === 1 ? parts[0]! : parts.length === 2 ? `${parts[0]} and ${parts[1]}` : `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`
  return `${text[0]!.toUpperCase()}${text.slice(1)}.`
}

// ---- formatting ----
const n1 = (x: number | null, d = 1) => (x === null ? '–' : x.toFixed(d))
const pctOf = (x: number | null, d = 0) => (x === null ? '–' : `${(x * 100).toFixed(d)}%`)
export const msOf = (x: number | null) => (x === null ? '–' : x >= 1000 ? `${(x / 1000).toFixed(2)} s` : x < 1 ? '<1 ms' : `${Math.round(x)} ms`)
export const usdOf = (x: number | null) => {
  if (x === null) return '–'
  if (x === 0) return '$0'
  const digits = Math.min(10, Math.max(3, Math.ceil(-Math.log10(Math.abs(x))) + 2))
  return `$${x.toFixed(digits)}`
}
const signed = (x: number | null, d = 1) => (x === null ? '–' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}`)
const pOf = (p: number | null) => (p === null ? '–' : p < 0.001 ? '&lt;0.001' : p.toFixed(3))
const listOf = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)
const range = (xs: Array<number | null>, fmt: (x: number | null) => string) => {
  const v = xs.filter((x): x is number => x !== null)
  if (!v.length) return '–'
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  return lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`
}

/** 1st, 2nd, 3rd, 4th… */
const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`

// ---- figures (inline SVG, print-safe greys with one accent) ----
const INK = '#1a1a1a'
const MID = '#6b6b6b'
const LIGHT = '#c9c9c9'
const ACCENT = '#b07d1f'

function barFigure(rows: Array<{ label: string; value: number | null; whisker?: number | null; focus: boolean }>, unit: (x: number) => string, log: boolean): string {
  const w = 560
  const left = 196
  const right = 76
  const rowH = 24
  const h = rows.length * rowH + 30
  const values = rows.flatMap((r) => [r.value, r.whisker ?? null]).filter((v): v is number => v !== null && v > 0)
  if (!values.length) return `<svg viewBox="0 0 ${w} 40"><text x="10" y="24" font-size="11" fill="${MID}">no data</text></svg>`
  const lo = log ? Math.min(...values) / 1.6 : 0
  const hi = Math.max(...values) * (log ? 1.6 : 1.1)
  const x = (v: number) => left + (log ? (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) : v / hi) * (w - left - right)
  const bars = rows
    .map((r, i) => {
      const y = 12 + i * rowH
      const colour = r.focus ? ACCENT : MID
      if (r.value === null || r.value <= 0) return `<text x="${left - 8}" y="${y + 14}" text-anchor="end" font-size="11" fill="${INK}">${esc(r.label)}</text><text x="${left + 4}" y="${y + 14}" font-size="10" fill="${MID}">–</text>`
      const whisker = r.whisker && r.whisker > 0 ? `<line x1="${x(r.value).toFixed(1)}" x2="${x(r.whisker).toFixed(1)}" y1="${y + 10}" y2="${y + 10}" stroke="${colour}" stroke-width="1"/><line x1="${x(r.whisker).toFixed(1)}" x2="${x(r.whisker).toFixed(1)}" y1="${y + 6}" y2="${y + 14}" stroke="${colour}" stroke-width="1"/>` : ''
      return (
        `<text x="${left - 8}" y="${y + 14}" text-anchor="end" font-size="11" fill="${INK}"${r.focus ? ' font-weight="700"' : ''}>${esc(r.label)}</text>` +
        `<rect x="${left}" y="${y + 4}" width="${Math.max(1, x(r.value) - left).toFixed(1)}" height="12" fill="${colour}"/>` +
        whisker +
        `<text x="${(Math.max(x(r.value), r.whisker ? x(r.whisker) : 0) + 6).toFixed(1)}" y="${y + 14}" font-size="10" fill="${INK}">${esc(unit(r.value))}</text>`
      )
    })
    .join('')
  return `<svg viewBox="0 0 ${w} ${h}" role="img">${bars}<line x1="${left}" x2="${left}" y1="8" y2="${h - 16}" stroke="${LIGHT}"/><text x="${left}" y="${h - 4}" font-size="9" fill="${MID}">${log ? 'log scale' : ''}</text></svg>`
}

function forest(rows: Array<{ label: string; mean: number | null; low: number | null; high: number | null; focus: boolean }>): string {
  const w = 560
  const left = 196
  const right = 30
  const rowH = 24
  const h = rows.length * rowH + 34
  const finite = rows.flatMap((r) => [r.mean, r.low, r.high]).filter((v): v is number => v !== null)
  const span = Math.max(1, ...finite.map(Math.abs)) * 1.15
  const x = (v: number) => left + ((Math.max(-span, Math.min(span, v)) + span) / (2 * span)) * (w - left - right)
  const lines = rows
    .map((r, i) => {
      const y = 14 + i * rowH + 8
      const colour = r.focus ? ACCENT : INK
      const label = `<text x="${left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="${INK}"${r.focus ? ' font-weight="700"' : ''}>${esc(r.label)}</text>`
      if (r.mean === null) return label
      const lo = r.low === null ? left : x(r.low)
      const hi = r.high === null ? w - right : x(r.high)
      return `${label}<line x1="${lo.toFixed(1)}" x2="${hi.toFixed(1)}" y1="${y}" y2="${y}" stroke="${colour}" stroke-width="1.3"/><line x1="${lo.toFixed(1)}" x2="${lo.toFixed(1)}" y1="${y - 4}" y2="${y + 4}" stroke="${colour}"/><line x1="${hi.toFixed(1)}" x2="${hi.toFixed(1)}" y1="${y - 4}" y2="${y + 4}" stroke="${colour}"/><circle cx="${x(r.mean).toFixed(1)}" cy="${y}" r="3.5" fill="${colour}"/>`
    })
    .join('')
  const axis = `<line x1="${x(0)}" x2="${x(0)}" y1="8" y2="${h - 22}" stroke="${LIGHT}" stroke-dasharray="3 3"/><text x="${x(-span)}" y="${h - 8}" font-size="9" fill="${MID}">${(-span).toFixed(0)}</text><text x="${x(0)}" y="${h - 8}" text-anchor="middle" font-size="9" fill="${MID}">0 bb/100</text><text x="${x(span)}" y="${h - 8}" text-anchor="end" font-size="9" fill="${MID}">${span.toFixed(0)}</text>`
  return `<svg viewBox="0 0 ${w} ${h}" role="img">${axis}${lines}</svg>`
}

function reliability(cal: Calibration | null, label: string, focus: boolean): string {
  const s = 150
  const pad = 22
  const inner = s - 2 * pad
  const px = (v: number) => pad + v * inner
  const py = (v: number) => s - pad - v * inner
  const bins = (cal?.bins ?? []).filter((b) => b.n > 0 && b.meanPredicted !== null && b.meanObserved !== null)
  const maxN = Math.max(1, ...bins.map((b) => b.n))
  const colour = focus ? ACCENT : INK
  const path = bins.map((b, i) => `${i ? 'L' : 'M'}${px(b.meanPredicted!).toFixed(1)},${py(b.meanObserved!).toFixed(1)}`).join('')
  const dots = bins.map((b) => `<circle cx="${px(b.meanPredicted!).toFixed(1)}" cy="${py(b.meanObserved!).toFixed(1)}" r="${(1.5 + 4 * Math.sqrt(b.n / maxN)).toFixed(1)}" fill="${colour}"/>`).join('')
  const body =
    `<rect x="${pad}" y="${pad}" width="${inner}" height="${inner}" fill="none" stroke="${LIGHT}"/>` +
    `<line x1="${px(0)}" y1="${py(0)}" x2="${px(1)}" y2="${py(1)}" stroke="${LIGHT}" stroke-dasharray="3 3"/>` +
    (path ? `<path d="${path}" fill="none" stroke="${colour}" stroke-width="1.2"/>` : '') +
    dots +
    `<text x="${px(0.5)}" y="${s - 5}" text-anchor="middle" font-size="8" fill="${MID}">stated</text>` +
    `<text x="8" y="${py(0.5)}" text-anchor="middle" font-size="8" fill="${MID}" transform="rotate(-90 8 ${py(0.5)})">true</text>`
  const stats = cal?.n ? `n ${cal.n} · Brier ${n1(fin(cal.brier), 3)} · ECE ${n1(fin(cal.ece), 3)}` : 'no stated chances'
  return `<div class="panel"><svg viewBox="0 0 ${s} ${s}" role="img">${body}</svg><div class="panel-cap"><b>${esc(label)}</b><br>${esc(stats)}</div></div>`
}

/** The study as a diagram: one deal, every seat, every model, every decision re-scored from all the cards. */
function pipeline(models: number): string {
  const box = (x: number, y: number, w: number, t1: string, t2: string, accent = false) =>
    `<rect x="${x}" y="${y}" width="${w}" height="46" rx="4" fill="${accent ? '#fbf3e3' : '#f4f4f4'}" stroke="${accent ? ACCENT : LIGHT}"/><text x="${x + w / 2}" y="${y + 20}" text-anchor="middle" font-size="10.5" fill="${INK}" font-weight="700">${esc(t1)}</text><text x="${x + w / 2}" y="${y + 35}" text-anchor="middle" font-size="9" fill="${MID}">${esc(t2)}</text>`
  const arrow = (x1: number, x2: number, y: number) => `<line x1="${x1}" x2="${x2 - 6}" y1="${y}" y2="${y}" stroke="${MID}" stroke-width="1"/><path d="M${x2 - 6},${y - 3} L${x2},${y} L${x2 - 6},${y + 3}z" fill="${MID}"/>`
  return `<svg viewBox="0 0 700 70" role="img">${box(0, 12, 120, 'Seeded deal', 'one card order per group')}${arrow(120, 150, 35)}${box(150, 12, 130, `${models} rotations`, 'every seat gets every hand')}${arrow(280, 310, 35)}${box(310, 12, 130, 'Priced menu', 'each model picks one', true)}${arrow(440, 470, 35)}${box(470, 12, 100, 'Engine', 'settles every chip')}${arrow(570, 600, 35)}${box(600, 12, 100, 'Re-scored', 'from all hole cards')}</svg>`
}

// ---- the document ----
const CSS = `
@page{size:Letter;margin:17mm 15mm 18mm;@bottom-center{content:counter(page);font:8pt Georgia,serif;color:#777}}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;color:${INK};font:9.4pt/1.42 Charter,"Bitstream Charter","Sitka Text",Cambria,Georgia,serif;text-rendering:optimizeLegibility;hyphens:auto}
header.title{text-align:center;margin:0 0 5mm}
header.title h1{font-size:16.5pt;line-height:1.2;margin:0 0 3mm;font-weight:700}
header.title .authors{font-size:10pt;margin:0 0 1mm}
header.title .meta{font-size:8.3pt;color:#555}
.abstract{margin:0 9mm 5mm;font-size:8.8pt;line-height:1.4}
.abstract h2{text-align:center;font-size:9.4pt;margin:0 0 1.5mm}
.cols{column-count:2;column-gap:6.5mm;column-fill:auto}
h2{font-size:10.6pt;margin:4.5mm 0 1.6mm;break-after:avoid}
h3{font-size:9.6pt;font-style:italic;font-weight:600;margin:3mm 0 1.2mm;break-after:avoid}
p{margin:0 0 2mm;text-align:justify}
ul{margin:0 0 2mm;padding-left:4.5mm}li{margin:0 0 .8mm;text-align:justify}
figure{margin:2.5mm 0 3mm;break-inside:avoid}
figure.wide{column-span:all}
figure svg{width:100%;height:auto;display:block}
figcaption{font-size:8.2pt;line-height:1.35;margin-top:1.4mm;text-align:justify}
figcaption b{font-weight:700}
.panels{display:grid;grid-template-columns:repeat(5,1fr);gap:2.5mm}
.panel svg{width:100%}
.panel-cap{font-size:7.4pt;line-height:1.3;text-align:center;color:#444}.panel-cap b{color:${INK}}
table{border-collapse:collapse;width:100%;font:7.9pt/1.3 Charter,Georgia,serif;font-variant-numeric:tabular-nums;margin:1mm 0}
thead th{border-top:1.2px solid ${INK};border-bottom:.7px solid ${INK};font-weight:700;padding:1.2mm 1.4mm;text-align:right}
tbody td{padding:.9mm 1.4mm;text-align:right;border-bottom:.3px solid #e3e3e3;white-space:nowrap}
tbody td:first-child{white-space:normal}
tbody tr:last-child td{border-bottom:1.2px solid ${INK}}
th:first-child,td:first-child{text-align:left}
tr.focus td{font-weight:700}
tr.hosted td{border-bottom:none;padding-bottom:0}
tr.hosts td{font-size:7pt;color:${MID};text-align:left;white-space:normal;padding-top:.2mm;font-weight:400}
.tablecap{font-size:8.2pt;margin:3mm 0 1mm;break-after:avoid}
.wide{column-span:all}
.refs li{font-size:8.2pt;margin-bottom:1.2mm;text-align:left}
code{font:7.8pt Menlo,Consolas,monospace;word-break:break-all}
.note{font-size:8.2pt;color:#444}
`

/** A rehearsal says so at the head of every page, in the margin where it can't cover the text. */
const REHEARSAL_CSS = `@page{@top-center{content:"REHEARSAL ON MOCK PLAYERS — NOT RESULTS";font:700 7.5pt -apple-system,Helvetica,Arial,sans-serif;letter-spacing:.14em;color:#b3261e}}`

export interface PaperOptions {
  /** A rehearsal on mock players: every page says so, and nothing reads as a result. */
  mock: boolean
  /** Who wrote it, for the title block. */
  author?: string
  /** Month and year for the title block (from the report's date otherwise). */
  date?: string
}

/** The paper, as one self-contained HTML document for a browser to print (no scripts, no external requests). */
export function renderPaperHtml(report: StudyReport, decisions: readonly ScoredDecision[], opts: PaperOptions): string {
  const f = paperFacts(report, decisions)
  const all = [f.focus, ...f.others]
  const prereg = report.study.preregistration as {
    study?: { format?: { bigBlind?: number; smallBlind?: number; stackInBigBlinds?: number }; decisionTimeoutMs?: number; targetHalfWidthBb100?: number; minGroups?: number; maxGroups?: number; checkEvery?: number; masterSeed?: string }
    seating?: { neighbourBlock?: number }
    menu?: { chipUnit?: number }
    prices?: { jevInputUsdPerMTok?: number }
  }
  const fmt = prereg.study?.format ?? {}
  const block = prereg.seating?.neighbourBlock ?? 4
  const date = opts.date ?? new Date(report.generatedAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const author = opts.author ?? 'Jobin Ayathil'
  const focusName = f.focus.kind === 'jev' ? 'Jev' : f.focus.label
  const otherNames = f.others.map((o) => o.label)
  const hands = report.study.hands
  const groups = report.study.analysedGroups
  const blocks = report.study.blocks
  const title = 'Stated Confidence Against True Equity: A Typed-Readout Decision Model and General-Purpose Language Models at No-Limit Texas Hold’em'

  // ---- sentences built from facts ----
  const speedLine =
    f.speed.timesFasterThanFastest !== null
      ? f.speed.timesFasterThanFastest >= CLAIM_RATIO
        ? `${focusName} answered in a median of ${msOf(f.focus.latencyP50Ms)}, ${times(f.speed.timesFasterThanFastest)} faster than the fastest general-purpose model (${esc(f.speed.fastestOther!.label)}, ${msOf(f.speed.fastestOther!.latencyP50Ms)})${f.speed.timesFasterThanSlowest && f.speed.timesFasterThanSlowest !== f.speed.timesFasterThanFastest ? ` and ${times(f.speed.timesFasterThanSlowest)} faster than the slowest (${esc(f.speed.slowestOther!.label)}, ${msOf(f.speed.slowestOther!.latencyP50Ms)})` : ''}.`
        : `${focusName}'s median time to a decision (${msOf(f.focus.latencyP50Ms)}) was not clearly faster than the fastest general-purpose model's (${esc(f.speed.fastestOther!.label)}, ${msOf(f.speed.fastestOther!.latencyP50Ms)}).`
      : 'Decision times were not recorded for every model.'
  const costLine =
    f.cost.timesCheaperThanCheapest !== null
      ? f.cost.timesCheaperThanCheapest >= CLAIM_RATIO
        ? `A decision cost ${usdOf(f.focus.costPerDecisionUsd)} with ${focusName}, ${times(f.cost.timesCheaperThanCheapest)} less than with the cheapest general-purpose model (${esc(f.cost.cheapestOther!.label)}, ${usdOf(f.cost.cheapestOther!.costPerDecisionUsd)})${f.cost.timesCheaperThanDearest && f.cost.timesCheaperThanDearest !== f.cost.timesCheaperThanCheapest ? ` and ${times(f.cost.timesCheaperThanDearest)} less than with the most expensive (${esc(f.cost.dearestOther!.label)}, ${usdOf(f.cost.dearestOther!.costPerDecisionUsd)})` : ''}.`
        : `A decision cost ${usdOf(f.focus.costPerDecisionUsd)} with ${focusName}, not clearly less than with the cheapest general-purpose model (${esc(f.cost.cheapestOther!.label)}, ${usdOf(f.cost.cheapestOther!.costPerDecisionUsd)}).`
      : 'Costs were not recorded for every model.'
  const truthLine =
    f.focus.offTruthPts === null
      ? `${focusName} did not state win chances that could be scored.`
      : f.truth.focusBest
        ? `${focusName}'s stated win chance sat ${n1(f.focus.offTruthPts)} percentage points from the true chance on average, closer than every general-purpose model (${range(f.others.map((o) => o.offTruthPts), (x) => n1(x))} points).`
        : `${focusName}'s stated win chance sat ${n1(f.focus.offTruthPts)} percentage points from the true chance on average; ${esc(f.truth.bestOther?.label ?? '')} was closest at ${n1(f.truth.bestOther?.offTruthPts ?? null)} points.`
  const chipLine = f.significantChipWins.length
    ? `After Holm's correction over the pre-registered comparisons, ${focusName} won significantly more chips than ${listOf(f.significantChipWins.map((o) => esc(o.label)))}${f.significantChipLosses.length ? ` and significantly fewer than ${listOf(f.significantChipLosses.map((o) => esc(o.label)))}` : ''}; no other chip difference was significant.`
    : f.significantChipLosses.length
      ? `After Holm's correction over the pre-registered comparisons, ${focusName} won significantly fewer chips than ${listOf(f.significantChipLosses.map((o) => esc(o.label)))}; no other chip difference was significant.`
      : `No chip difference between ${focusName} and any other model was significant after Holm's correction over the pre-registered comparisons: at ${hands.toLocaleString('en-US')} hands the intervals remain wide.`
  const leanLine = (() => {
    const lean = (dir: 1 | -1) => all.filter((m) => m.biasPts !== null && dir * m.biasPts >= 5)
    const say = (ms: ModelFacts[], verb: string) =>
      ms.length === all.length
        ? `Every model ${verb} its chances (by ${range(ms.map((m) => Math.abs(m.biasPts!)), (x) => n1(x))} points on average)`
        : `${listOf(ms.map((m) => esc(m.label)))} ${verb} ${ms.length === 1 ? 'its' : 'their'} chances (by ${range(ms.map((m) => Math.abs(m.biasPts!)), (x) => n1(x))} points on average)`
    const up = lean(1)
    const down = lean(-1)
    if (!up.length && !down.length) return 'No model leaned consistently: over- and under-statements roughly cancelled for each.'
    return `${[up.length ? say(up, 'overstated') : '', down.length ? say(down, 'understated') : ''].filter(Boolean).join('; ')}.`
  })()

  const others = f.others
  /** How the text names a model: the focus by its short name. */
  const nameOf = (m: ModelFacts) => (m.focus ? focusName : esc(m.label))
  // Level with the best as printed (three decimals): named together, the focus first.
  const levelBest = f.outcome.best ? all.filter((m) => m.brierA !== null && n1(m.brierA, 3) === n1(f.outcome.best!.brierA, 3)) : []
  const outcomeLine =
    levelBest.length > 1
      ? `Against the pre-registered headline outcome, the share of the main pot each model actually won, ${listOf(levelBest.map(nameOf))} scored best (Brier ${n1(f.outcome.best!.brierA, 3)})${levelBest.some((m) => m.focus) ? '' : `; ${focusName} ranked ${ord(f.outcome.focusRank!)} of ${f.outcome.of} (Brier ${n1(f.focus.brierA, 3)})`}.`
      : f.outcome.best && f.outcome.focusRank !== null
      ? f.outcome.focusRank === 1
        ? `Against the pre-registered headline outcome, the share of the main pot each model actually won, ${focusName} scored best (Brier ${n1(f.focus.brierA, 3)}; the language models ${range(others.map((o) => o.brierA), (x) => n1(x, 3))}).`
        : `Against the pre-registered headline outcome, the share of the main pot each model actually won, ${esc(f.outcome.best.label)} scored best (Brier ${n1(f.outcome.best.brierA, 3)}); ${focusName} ranked ${ord(f.outcome.focusRank)} of ${f.outcome.of} (Brier ${n1(f.focus.brierA, 3)}).`
      : ''
  const eceLine =
    f.focus.eceC === null
      ? ''
      : f.calibration.focusBestEce
        ? `Against the true chance, ${focusName}’s stated chances were the best calibrated on average (ECE ${n1(f.focus.eceC, 3)}; the language models ${range(others.map((o) => o.eceC), (x) => n1(x, 3))}): in each band, what it stated came true about as often as it said.`
        : `Against the true chance, the best-calibrated stated chances came from ${esc(f.calibration.bestOtherEce?.label ?? 'another model')} (ECE ${n1(f.calibration.bestOtherEce?.eceC ?? null, 3)}); ${focusName}’s ECE was ${n1(f.focus.eceC, 3)}.`
  // Right on average but seldom far from the middle: calibrated, with little resolution.
  const narrowest = f.focus.spreadPts !== null && others.every((o) => o.spreadPts === null || f.focus.spreadPts! < o.spreadPts)
  const spreadLine =
    f.focus.spreadPts === null
      ? ''
      : `The stated chances’ standard deviation was ${n1(f.focus.spreadPts)} points for ${focusName} and ${range(others.map((o) => o.spreadPts), (x) => n1(x))} for the language models, while the true chances in ${focusName}’s spots varied by ${n1(f.focus.truthSpreadPts)}.${
          narrowest && f.calibration.focusBestEce && !f.truth.focusBest
            ? ` ${focusName}’s estimates were right on average but stayed near the middle, so one at a time they sat further from the truth than ${esc(f.truth.bestOther?.label ?? 'the closest model')}’s.`
            : ''
        }`
  const byRate = (key: 'foldRight' | 'callRight', dir: 1 | -1) => by(all, (m) => (m[key].n ? m[key].rate : null), dir)
  const accuracyLine = (() => {
    const [bf, wf, bc, wc] = [byRate('foldRight', -1), byRate('foldRight', 1), byRate('callRight', -1), byRate('callRight', 1)]
    if (!bf || !wf || !bc || !wc) return ''
    return `Folds were most often right for ${nameOf(bf)} (${pctOf(bf.foldRight.rate)}) and least for ${nameOf(wf)} (${pctOf(wf.foldRight.rate)}); calls, for ${nameOf(bc)} (${pctOf(bc.callRight.rate)}) and ${nameOf(wc)} (${pctOf(wc.callRight.rate)}). ${focusName}’s folds were right ${pctOf(f.focus.foldRight.rate)} of ${f.focus.foldRight.n} times and its calls ${pctOf(f.focus.callRight.rate)} of ${f.focus.callRight.n}.`
  })()
  const styleOf = (id: string) => report.metrics.find((x) => x.playerId === id)?.style
  const vpipOf = (m: ModelFacts) => fin(styleOf(m.playerId)?.vpip)
  const pfrOf = (m: ModelFacts) => fin(styleOf(m.playerId)?.pfr)
  const styleLine =
    vpipOf(f.focus) === null
      ? ''
      : `${focusName} played ${pctOf(vpipOf(f.focus))} of hands before the flop and raised first in ${pctOf(pfrOf(f.focus))}; the language models played ${range(others.map(vpipOf), (x) => pctOf(x))} and raised first in ${range(others.map(pfrOf), (x) => pctOf(x))}.`

  const discussCalibration = (() => {
    const rank = f.outcome.focusRank
    if (rank === null) return f.truth.focusBest ? `${focusName}’s stated chances sat closer to the truth than every language model’s.` : ''
    const bestA = rank === 1
    const bestC = f.calibration.focusBestEce
    if (bestA && bestC) return `${focusName}’s stated chances scored best on both measures: against the pot actually won, the pre-registered headline, and, on average, against the true chance.`
    if (bestA) return `${focusName} scored best against the pot actually won, the pre-registered headline, though ${esc(f.calibration.bestOtherEce?.label ?? 'another model')}’s stated chances were better calibrated against the true chance.`
    if (bestC)
      return `The two calibration measures disagree about ${focusName}. Against the true chance at the moment of the decision its stated chances were the best calibrated on average, yet against the pot actually won, the pre-registered headline, it ranked ${ord(rank)} of ${f.outcome.of}. A Brier score against a won-or-lost outcome rewards confident estimates that turn out right${narrowest ? `, and ${focusName}’s stayed nearer the middle than any language model’s` : ''}; the headline outcome also counts what happened after the decision, including the player’s own later folds.`
    return `Calibration did not favour ${focusName}: ${esc(f.outcome.best?.label ?? 'another model')} scored best against the pot actually won, and ${esc(f.calibration.bestOtherEce?.label ?? 'another model')} against the true chance.`
  })()
  const moves = f.moveRule
  const discussStyle =
    moves && f.focus.kind === 'jev' && moves.moves > 0
      ? `${focusName}’s play was only partly its own: the pre-registered move rule changed ${pctOf(moves.changed / moves.moves)} of its moves${moves.changed > 0 && moves.toRaise === moves.changed ? ', every one of them towards betting or raising' : ''}${vpipOf(f.focus) !== null ? `, and it played ${pctOf(vpipOf(f.focus))} of hands before the flop against ${range(others.map(vpipOf), (x) => pctOf(x))} for the language models` : ''}. Its calls were right against the pot odds ${pctOf(f.focus.callRight.rate)} of the time. How much of this is the rule and how much Jev can be read from the published probabilities.`
      : ''
  const conclusion = [
    f.speed.timesFasterThanFastest !== null && f.speed.timesFasterThanFastest >= CLAIM_RATIO ? `${focusName} was ${times(f.speed.timesFasterThanFastest)} faster than the fastest language model` : '',
    f.cost.timesCheaperThanCheapest !== null && f.cost.timesCheaperThanCheapest >= CLAIM_RATIO ? `${times(f.cost.timesCheaperThanCheapest)} cheaper than the cheapest` : '',
  ].filter(Boolean)
  const conclusionHtml = [
    conclusion.length ? `${conclusion.join(' and ')}.` : '',
    f.outcome.focusRank === null ? '' : f.outcome.focusRank === 1 ? `Against the pot actually won, the pre-registered headline, its stated chances scored best.` : `Against the pot actually won, the pre-registered headline, its stated chances ranked ${ord(f.outcome.focusRank)} of ${f.outcome.of}.`,
    f.calibration.focusBestEce ? `Against the true chance they were the best calibrated on average${narrowest ? ', but the least spread out' : ''}.` : '',
    f.significantChipWins.length || f.significantChipLosses.length ? chipLine : `No chip difference was significant at ${hands.toLocaleString('en-US')} hands.`,
    'The protocol, the analysis and the decision-level data are released with this report.',
  ]
    .filter(Boolean)
    .join(' ')

  // ---- tables ----
  const row = (m: ModelFacts, cells: string[], cls: string[] = []) => {
    const classes = [...cls, ...(m.focus ? ['focus'] : [])]
    return `<tr${classes.length ? ` class="${classes.join(' ')}"` : ''}><td>${esc(m.label)}</td>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`
  }
  const lineupTable = `<table><thead><tr><th>Model</th><th>Kind</th><th>Decisions</th><th>Fallbacks</th></tr></thead><tbody>${all.map((m) => row(m, [esc(m.kind === 'jev' ? 'typed readout' : m.kind === 'llm' ? 'language model' : m.kind), m.answered.toLocaleString('en-US'), pctOf(m.fallbackRate, 1)])).join('')}</tbody></table>`
  const anyHosts = all.some((m) => m.hosts.length > 0)
  const hostsOf = (m: ModelFacts) => (m.hosts.length ? m.hosts.map((h) => `${esc(h.name)} ${h.share < 0.005 ? '&lt;1%' : pctOf(h.share)}`).join(', ') : m.kind === 'jev' ? 'TypeSafe' : '–')
  const speedTable = `<table><thead><tr><th>Model</th><th>Median</th><th>95th pct.</th><th>$ / decision</th></tr></thead><tbody>${all
    .map((m) => {
      const cells = [msOf(m.latencyP50Ms), msOf(m.latencyP95Ms), usdOf(m.costPerDecisionUsd)]
      return anyHosts ? `${row(m, cells, ['hosted'])}<tr class="hosts"><td colspan="4">served by ${hostsOf(m)}</td></tr>` : row(m, cells)
    })
    .join('')}</tbody></table>`
  const rule = f.moveRule
  const ruleLine = rule
    ? `<p>The pre-registered move rule (Section 2.1) changed ${rule.changed.toLocaleString('en-US')} of ${esc(focusName)}’s ${rule.moves.toLocaleString('en-US')} moves (${pctOf(rule.changed / rule.moves)}) from TypeSafe’s single most likely option: ${listOf(
        [
          [rule.toRaise, 'to a bet or raise'],
          [rule.toCall, 'to a check or call'],
          [rule.toFold, 'to a fold'],
        ]
          .filter(([n]) => (n as number) > 0)
          .map(([n, what]) => `${n} ${what}`),
      ) || 'none'}. Every probability ${esc(focusName)} gave is in the published data, so the moves under either rule can be compared.</p>`
    : ''
  const truthTable = `<table><thead><tr><th>Model</th><th>Off truth (pts)</th><th>Lean (pts)</th><th>Brier</th><th>ECE</th></tr></thead><tbody>${all.map((m) => row(m, [n1(m.offTruthPts), signed(m.biasPts), n1(m.brierC, 3), n1(m.eceC, 3)])).join('')}</tbody></table>`
  const wonTable = `<table><thead><tr><th>Model</th><th>Brier</th><th>ECE</th><th>SD stated</th><th>SD true</th></tr></thead><tbody>${all.map((m) => row(m, [n1(m.brierA, 3), n1(m.eceA, 3), n1(m.spreadPts), n1(m.truthSpreadPts)])).join('')}</tbody></table>`
  const actionTable = `<table><thead><tr><th>Model</th><th>Folds</th><th>right</th><th>Calls</th><th>right</th></tr></thead><tbody>${all.map((m) => row(m, [String(m.foldRight.n), pctOf(m.foldRight.rate), String(m.callRight.n), pctOf(m.callRight.rate)])).join('')}</tbody></table>`
  const chipTable = `<table><thead><tr><th>Model</th><th>bb/100</th><th>95% CI</th><th>${esc(focusName)} − model</th><th>p (Holm)</th></tr></thead><tbody>${all
    .map((m) => row(m, [signed(m.bb100.mean), m.bb100.low === null || m.bb100.high === null ? '–' : `[${n1(m.bb100.low)}, ${n1(m.bb100.high)}]`, m.vsFocus ? signed(m.vsFocus.mean) : '—', m.vsFocus ? pOf(m.vsFocus.pHolm) : '—']))
    .join('')}</tbody></table>`

  const styleTable = `<table><thead><tr><th>Model</th><th>VPIP</th><th>PFR</th><th>AF</th><th>WTSD</th></tr></thead><tbody>${all
    .map((m) => {
      const st = styleOf(m.playerId)
      return row(m, [pctOf(fin(st?.vpip)), pctOf(fin(st?.pfr)), n1(fin(st?.af), 2), pctOf(fin(st?.wtsd))])
    })
    .join('')}</tbody></table>`
  // Studies before the rule was pre-registered played TypeSafe's single most likely option.
  const moveRule = (prereg as { jevMove?: string }).jevMove
    ? ' Raising comes in several sizes while calling is one option, so the single most likely option would under-count raising; the move played is the kind of move with the most total weight (fold, check or call, bet or raise), then the most likely option of that kind.'
    : ' The move played is its single most likely option.'
  const prompts = (prereg as { prompts?: Record<string, string> }).prompts ?? {}
  const promptNames: Record<string, string> = { jevAction: `${focusName}: which action`, jevWin: `${focusName}: win question`, llmSystem: 'Language models: system prompt' }
  const promptsHtml = Object.entries(prompts)
    .map(([k, v]) => `<h3>${esc(promptNames[k] ?? k)}</h3><p class="note"><code>${esc(v)}</code></p>`)
    .join('')
  const recordRows: Array<[string, unknown]> = [
    ['Stopping rule', (prereg as { stopping?: string }).stopping],
    ['Intervals', (prereg as { intervals?: string }).intervals],
    ['Comparisons', (prereg as { contrasts?: string }).contrasts],
    ['Seating', (prereg as { seating?: { design?: string } }).seating?.design],
    [`${focusName}’s move`, (prereg as { jevMove?: string }).jevMove],
    ['Prices', (prereg as { prices?: { jevInputUsdPerMTok?: number; llm?: string } }).prices ? `${focusName}: $${prereg.prices?.jevInputUsdPerMTok} per million input tokens; language models: ${(prereg as { prices?: { llm?: string } }).prices?.llm ?? ''}` : null],
    ['Master seed', prereg.study?.masterSeed],
  ]
  const recordHtml = `<ul>${recordRows
    .filter(([, v]) => typeof v === 'string' && v.length > 0)
    .map(([k, v]) => `<li><b>${esc(k)}.</b> ${esc(v)}</li>`)
    .join('')}</ul>`

  // ---- figures ----
  const fig = (n: number, body: string, caption: string, wide = false) => `<figure${wide ? ' class="wide"' : ''}>${body}<figcaption><b>Figure ${n}.</b> ${caption}</figcaption></figure>`
  const figPipeline = fig(1, pipeline(all.length), `The study design. Each group deals one card order and plays it ${all.length} times, rotating the models through the seats so every model plays every hand from every seat; each model picks from the same priced menu of actions, the engine settles all chips, and every decision is re-scored afterwards from every player's hole cards.`, true)
  const figCalibration = fig(2, `<div class="panels">${all.map((m) => reliability(m.calibrationC, m.label, m.focus)).join('')}</div>`, 'Reliability of the stated win chance against the true chance at the moment of the decision (exact enumeration of the remaining board given every hole card). Points on the diagonal are perfectly calibrated; dot area is the number of decisions in the bin.', true)
  const figSpeed = fig(3, barFigure(all.map((m) => ({ label: m.label, value: m.latencyP50Ms, whisker: m.latencyP95Ms, focus: m.focus })), (v) => msOf(v), true), 'Time to a decision: median (bar) and 95th percentile (whisker), log scale.')
  const figCost = fig(4, barFigure(all.map((m) => ({ label: m.label, value: m.costPerDecisionUsd, focus: m.focus })), (v) => usdOf(v), true), 'Cost per decision at the prices of the run, log scale.')
  const figChips = fig(5, forest(all.map((m) => ({ label: m.label, mean: m.bb100.mean, low: m.bb100.low, high: m.bb100.high, focus: m.focus }))), `Chips won per 100 hands in big blinds, with 95% Student t intervals over ${blocks} neighbour blocks. Intervals are marginal, not simultaneous; claims about ${focusName} rest on the paired comparisons in Table 6.`)

  const sectionsHtml = `
<h2>1 Introduction</h2>
<p>A decision model that will act on someone’s behalf should know how likely it is to be right. Stated confidence is easy to ask for and hard to check: most tasks settle slowly, if at all, and their outcomes mix judgement with luck. Poker settles both problems. Every decision is a choice under hidden information, priced in chips, and resolved within seconds; and once every hole card is known, the chance a player had of winning at the moment it acted can be computed exactly.</p>
<p>We use this to measure ${esc(focusName)}, TypeSafe’s typed-readout decision model, against ${listOf(otherNames.map(esc))}. Each model plays the same deals from every seat. At each decision it states its chance of winning the hand, and we compare that claim with the true chance computed from all the cards. We also record how long each decision took, what it cost, how often a model failed to answer, whether its folds and calls were right against the pot odds, and how many chips it won.</p>
<p>Our contributions are a pre-registered protocol for measuring stated confidence against true equity in multi-player games, an analysis of ${report.study.decisions.toLocaleString('en-US')} decisions over ${hands.toLocaleString('en-US')} hands, and the decision-level data behind every figure.</p>

<h2>2 Background</h2>
<h3>2.1 Typed readout</h3>
<p>${esc(focusName)} does not write text. It is sent the table state and a fixed set of named options, and returns a probability for each option together with its answer to a second typed question: the probability that it wins the hand. Its answers can only come from the options offered, so every answer is legal by construction; numbers such as bet sizes stay in code.${moveRule}</p>
<h3>2.2 General-purpose models</h3>
<p>The language models receive the same state as JSON, with the same options, and reply with the option they choose, their stated chance of winning, a confidence in the move and one line of reasoning. An answer that cannot be parsed, names an option that was not offered, or arrives after ${Math.round((prereg.study?.decisionTimeoutMs ?? 20000) / 1000)} seconds is replaced by check-or-fold and counted as a fallback.</p>
<h3>2.3 Related work</h3>
<p>Poker has long served as a test of decision-making under hidden information, from heads-up solvers [5] to superhuman multi-player play [6]. Calibration is measured with the Brier score [1] and the expected calibration error [2]; language models have been shown to be partly calibrated about their own answers [3]. Paired comparisons across several models are corrected for multiplicity with Holm’s procedure [4].</p>

<h2>3 Method</h2>
<h3>3.1 Game</h3>
<p>No-Limit Texas Hold’em, ${all.length}-handed, with blinds of ${fmt.smallBlind ?? 50}/${fmt.bigBlind ?? 100} and ${fmt.stackInBigBlinds ?? 100} big blinds behind at the start of every hand. The engine offers each player a priced menu of legal actions (fold, check or call, and raises in steps of ${prereg.menu?.chipUnit ?? 25} chips) and settles every pot, including side pots; no model ever writes a number.</p>
<h3>3.2 Duplicate seating</h3>
<p>Luck in the cards is removed by design. A group deals one seeded card order ${all.length} times, rotating the players through the seats, so every model receives every hand from every seat. Groups are analysed in neighbour blocks of ${block}, which also balances who sits next to whom. The study analysed ${groups} groups in ${blocks} blocks.</p>
<h3>3.3 Measures</h3>
<ul>
<li><b>Off the truth</b>: the mean absolute difference between a model’s stated win chance and its true chance at the moment of the decision, in percentage points; <b>lean</b> is the same difference with its sign kept.</li>
<li><b>Calibration</b>: the Brier score and expected calibration error (ECE, ten equal-width bins) of the stated chance against two outcomes. The pre-registered headline is the share of the main pot the player actually won (1, 1/k for a k-way split, 0 after any fold), which also counts what happened after the decision; the second is the true chance at the moment of the decision, which isolates the estimate. The standard deviation of the stated chances shows how far a model’s estimates move.</li>
<li><b>Move accuracy</b>: a fold is right if the true equity was below the pot odds, a call if it was at or above them. Checks and raises have no such rule and are not scored here.</li>
<li><b>Chips</b>: big blinds won per 100 hands, with 95% Student t intervals over neighbour blocks, and pre-registered paired comparisons of ${esc(focusName)} against each other model, corrected with Holm’s procedure.</li>
<li><b>Speed and cost</b>: wall-clock time and billed cost per decision the model answered itself.</li>
</ul>
<h3>3.4 Pre-registration and stopping</h3>
<p>The protocol, prompts, prices and stopping rule were fixed before any hand was played, and the analysis answers to that record (configuration hash <code>${esc(report.study.configHash.slice(0, 16))}</code>). The study checks every ${prereg.study?.checkEvery ?? '–'} groups and stops when every player’s interval half-width reaches ${prereg.study?.targetHalfWidthBb100 ?? '–'} bb/100, at ${prereg.study?.maxGroups ?? '–'} groups, or at its budget; this run ended by <i>${esc(report.study.endReason ?? report.study.status)}</i> after spending ${usdOf(report.study.costUsd)}.</p>

<h2>4 Results</h2>
<p class="tablecap"><b>Table 1.</b> The models and how many decisions each made itself.</p>
${lineupTable}
<h3>4.1 Speed and cost</h3>
<p>${speedLine} ${costLine}</p>
${figSpeed}
${figCost}
<p class="tablecap"><b>Table 2.</b> Time and cost per decision.</p>
${speedTable}
<h3>4.2 Stated confidence against the truth</h3>
<p>${outcomeLine} ${eceLine} ${truthLine} ${leanLine}</p>
${figCalibration}
<p class="tablecap"><b>Table 3.</b> Stated win chance against the true chance.</p>
${truthTable}
<p>${spreadLine}</p>
<p class="tablecap"><b>Table 4.</b> Stated win chance against the share of the main pot actually won (the pre-registered headline outcome), and how far the stated and true chances moved (standard deviations, in points).</p>
${wonTable}
${ruleLine}
<h3>4.3 Move accuracy</h3>
<p>Folds and calls are the two decisions with an exact right answer given the pot odds. Table 5 gives, for each model, how many of each it made and the share that were right. ${accuracyLine}</p>
<p class="tablecap"><b>Table 5.</b> Folds and calls against the pot odds.</p>
${actionTable}
<h3>4.4 Chips</h3>
<p>${chipLine}</p>
${figChips}
<p class="tablecap"><b>Table 6.</b> Chips per 100 hands, and the pre-registered paired comparisons.</p>
${chipTable}

<h3>4.5 Play style</h3>
<p>How each model played, from the same hands: the share of hands it chose to play before the flop (VPIP), the share it raised first in (PFR), its post-flop aggression (bets and raises per call, AF) and the share of flops it took to showdown (WTSD). ${styleLine}</p>
<p class="tablecap"><b>Table 7.</b> Play style.</p>
${styleTable}

<h2>5 Discussion</h2>
<p>${discussCalibration}</p>
${discussStyle ? `<p>${discussStyle}</p>` : ''}
<p>${f.cost.timesCheaperThanCheapest !== null && f.cost.timesCheaperThanCheapest >= CLAIM_RATIO ? `The differences in speed and cost are large enough to matter in deployment regardless of the chip result. ` : ''}Chip results need far more hands than calibration: a single decision contributes a full calibration point, while a chip difference only emerges over many hands, which is why the study was built around duplicate seating and a stopping rule on interval width.</p>

<h2>6 Limitations</h2>
<ul>
<li>The sample is ${hands.toLocaleString('en-US')} hands in ${blocks} blocks. Calibration, speed and cost rest on ${report.study.decisions.toLocaleString('en-US')} decisions and are reasonably precise; the chip intervals are ${f.focus.bb100.low !== null && f.focus.bb100.high !== null ? `±${n1((f.focus.bb100.high - f.focus.bb100.low) / 2)} bb/100 for ${esc(focusName)}` : 'wide'}, and most chip differences cannot be distinguished from zero.</li>
<li>One line-up, one prompt per model family and one stack depth were tested. Other prompts, reasoning settings or stack depths may change the language models’ results.</li>
<li>The true chance is the equity against the hands still live when the player acted; it ignores what later betting would have done, by design.</li>
<li>Brier scores and ECE are reported without intervals; small differences between them should not be read as a ranking.</li>
<li>Move accuracy covers folds and calls only. Checks and raises depend on later streets and are not scored with an exact rule.</li>
<li>Speed and cost depend on the providers’ infrastructure and prices at the time of the run.${anyHosts ? ' OpenRouter routes each call to one of several hosts; Table 2 lists which served each model.' : ''}</li>
</ul>

<h2>7 Conclusion</h2>
<p>${conclusionHtml}</p>

<h2>References</h2>
<ol class="refs">
<li>G. W. Brier. Verification of forecasts expressed in terms of probability. <i>Monthly Weather Review</i>, 78(1):1–3, 1950.</li>
<li>C. Guo, G. Pleiss, Y. Sun and K. Q. Weinberger. On calibration of modern neural networks. In <i>ICML</i>, 2017.</li>
<li>S. Kadavath et al. Language models (mostly) know what they know. <i>arXiv:2207.05221</i>, 2022.</li>
<li>S. Holm. A simple sequentially rejective multiple test procedure. <i>Scandinavian Journal of Statistics</i>, 6(2):65–70, 1979.</li>
<li>M. Moravčík et al. DeepStack: Expert-level artificial intelligence in heads-up no-limit poker. <i>Science</i>, 356(6337):508–513, 2017.</li>
<li>N. Brown and T. Sandholm. Superhuman AI for multiplayer poker. <i>Science</i>, 365(6456):885–890, 2019.</li>
</ol>

<h2>A Prompts</h2>
<p>The exact instructions every model received, from the pre-registration record. The table state itself is sent as JSON alongside them.</p>
${promptsHtml}

<h2>B Pre-registration</h2>
<p>The record the analysis answers to, fixed before the first hand (configuration hash <code>${esc(report.study.configHash)}</code>).</p>
${recordHtml}`

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}${opts.mock ? REHEARSAL_CSS : ''}</style></head>
<body>
<header class="title">
<h1>${esc(title)}</h1>
<p class="authors">${esc(author)}</p>
<p class="meta">Technical report · ${esc(date)} · study <code>${esc(report.study.id)}</code> · pre-registration <code>${esc(report.study.configHash.slice(0, 12))}</code></p>
</header>
<section class="abstract"><h2>Abstract</h2>
<p>We compare ${esc(focusName)}, a typed-readout decision model, with ${otherNames.length} general-purpose language models (${listOf(otherNames.map(esc))}) at ${all.length}-handed No-Limit Texas Hold’em, over ${hands.toLocaleString('en-US')} hands and ${report.study.decisions.toLocaleString('en-US')} decisions in a duplicate format that deals every card order to every seat. At each decision the model states its chance of winning, which we score against the true chance computed from every hole card. ${speedLine} ${costLine} ${outcomeLine} ${eceLine} ${chipLine} The study was pre-registered, and the decision-level data are published with this report.</p>
</section>
${figPipeline}
<div class="cols">${sectionsHtml}</div>
</body></html>
`
}
