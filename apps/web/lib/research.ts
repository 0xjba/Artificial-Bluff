import { msOf, times, usdOf, type ModelFacts, type PaperFacts } from '@ab/study/paper'

export interface Tile {
  value: string
  what: string
}

/** A ratio is only a claim past this (the paper uses the same bar). */
const CLAIM_RATIO = 1.5

const pct = (x: number | null, d = 0) => (x === null ? '–' : `${(x * 100).toFixed(d)}%`)
const dp3 = (x: number | null) => (x === null ? '–' : x.toFixed(3))
const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`
const pts = (x: number | null) => (x === null ? '–' : `${x.toFixed(1)} pts`)
const range = (xs: Array<number | null>, fmt: (x: number) => string) => {
  const v = xs.filter((x): x is number => x !== null)
  if (!v.length) return '–'
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  return fmt(lo) === fmt(hi) ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`
}
/** Folds and calls together: each has an exact right answer given the pot odds. */
const moveAccuracy = (m: ModelFacts) => {
  const n = m.foldRight.n + m.callRight.n
  return n ? ((m.foldRight.rate ?? 0) * m.foldRight.n + (m.callRight.rate ?? 0) * m.callRight.n) / n : null
}

/**
 * The measured figures at the top of the Research page, from the same facts the paper states, so the
 * two can never disagree. Each is set against the other models; a ratio appears only past the bar the
 * paper uses, and a chip result only when the pre-registered test found it.
 */
export function researchTiles(f: PaperFacts): Tile[] {
  const jev = f.focus
  const name = jev.kind === 'jev' ? 'Jev' : jev.label
  const others = f.others
  const tiles: Tile[] = []

  const faster = f.speed.timesFasterThanFastest
  tiles.push(
    faster !== null && faster >= CLAIM_RATIO && f.speed.fastestOther
      ? { value: times(faster), what: `faster to a decision: ${msOf(jev.latencyP50Ms)} median against ${msOf(f.speed.fastestOther.latencyP50Ms)} for ${f.speed.fastestOther.label}, the fastest of the others` }
      : { value: msOf(jev.latencyP50Ms), what: `median time to a decision, against ${range(others.map((o) => o.latencyP50Ms), (x) => msOf(x))} for the others` },
  )

  const cheaper = f.cost.timesCheaperThanCheapest
  tiles.push(
    cheaper !== null && cheaper >= CLAIM_RATIO && f.cost.cheapestOther
      ? { value: times(cheaper), what: `cheaper per decision: ${usdOf(jev.costPerDecisionUsd)} against ${usdOf(f.cost.cheapestOther.costPerDecisionUsd)} for ${f.cost.cheapestOther.label}, the cheapest of the others` }
      : { value: usdOf(jev.costPerDecisionUsd), what: `per decision, against ${range(others.map((o) => o.costPerDecisionUsd), (x) => usdOf(x))} for the others` },
  )

  // The pre-registered headline outcome, whichever way it went: the stated chance against the pot actually won.
  if (f.outcome.focusRank !== null)
    tiles.push({
      value: `${ord(f.outcome.focusRank)} of ${f.outcome.of}`,
      what: `by Brier score against the pot actually won, the pre-registered headline: ${name} ${dp3(jev.brierA)}; ${range(others.map((o) => o.brierA), dp3)} for the others`,
    })

  tiles.push({
    value: dp3(jev.eceC),
    what: `calibration error against the true odds (ECE, lower is better)${f.calibration.focusBestEce ? ', the lowest of any model' : ''}; ${range(others.map((o) => o.eceC), dp3)} for the others`,
  })

  tiles.push({ value: pts(jev.offTruthPts), what: `from the true odds, on average, when ${name} stated its chance of winning; ${range(others.map((o) => o.offTruthPts), (x) => x.toFixed(1))} pts for the others` })

  tiles.push({ value: pct(moveAccuracy(jev)), what: `of ${name}’s folds and calls were right against the pot odds; ${range(others.map(moveAccuracy), (x) => pct(x))} for the others` })

  const win = f.significantChipWins[0]
  const loss = f.significantChipLosses[0]
  const halfWidth = jev.bb100.low !== null && jev.bb100.high !== null ? (jev.bb100.high - jev.bb100.low) / 2 : null
  tiles.push(
    win?.vsFocus?.mean != null
      ? { value: `+${win.vsFocus.mean.toFixed(0)} bb`, what: `per 100 hands over ${win.label}, significant after Holm’s correction` }
      : loss?.vsFocus?.mean != null
        ? { value: `−${Math.abs(loss.vsFocus.mean).toFixed(0)} bb`, what: `per 100 hands against ${loss.label}, significant after Holm’s correction` }
        : { value: halfWidth === null ? '–' : `±${halfWidth.toFixed(0)} bb`, what: `per 100 hands is the interval on ${name}’s chips after ${f.study.hands.toLocaleString('en-US')} hands: no chip difference is significant yet` },
  )

  tiles.push({ value: f.decisions.toLocaleString('en-US'), what: `decisions scored against the true odds, worked out from every hole card, over ${f.study.hands.toLocaleString('en-US')} hands` })
  return tiles
}

/** What the figures rest on, and what they do not show: the paragraph under the tiles. */
export function researchCaveat(f: PaperFacts): string {
  const name = f.focus.kind === 'jev' ? 'Jev' : f.focus.label
  const chips = f.significantChipWins.length || f.significantChipLosses.length ? 'the chip results named above are significant after Holm’s correction, and no others are' : 'no chip difference is significant at this sample size, so none is claimed'
  return `Measured on ${f.study.hands.toLocaleString('en-US')} hands in ${f.study.blocks} blocks of duplicate deals (every card order played from every seat), in study ${f.study.id}, pre-registered as ${f.study.configHash.slice(0, 12)}. Speed, cost and calibration rest on ${f.decisions.toLocaleString('en-US')} decisions and are reasonably precise; ${chips}. ${name}’s and the others’ figures come from the same hands under the same rules. The report below covers the method, every figure and every limitation.`
}
