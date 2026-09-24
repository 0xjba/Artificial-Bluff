import { calibration, type ScoredDecision } from '@ab/analysis'
import { deriveSeed, mulberry32 } from '@ab/engine'
import { holm, tTestPValue } from './contrasts'
import { tInterval, type Interval } from './stats'

/** A point estimate with a 95% interval (null where there is nothing to estimate). */
export interface Estimate {
  value: number | null
  low: number | null
  high: number | null
}

export interface PlayerCalibrationStats {
  playerId: string
  /** Decisions with a stated win chance that the player answered itself. */
  n: number
  /** Brier score against the main-pot share won (outcome A, the pre-registered headline), with a 95% cluster-bootstrap CI over neighbour blocks. */
  brierA: Estimate
  /**
   * Brier skill score against a reference forecast that states a fair share (1 / players still in)
   * at every decision: 1 − Brier / Brier(reference). Above 0 beats the reference.
   */
  skillA: Estimate
  /** Expected calibration error against the true chance (outcome C), with a 95% cluster-bootstrap CI. */
  eceC: Estimate
  /**
   * Matched spots: decisions identical to one another player faced in the same duplicate group (the
   * same cards in the same seat, and the same actions so far, so the same state, board and menu).
   * Mean |stated − true chance| over this player's matched decisions, in points.
   */
  matched: { n: number; errorPts: number | null }
  /**
   * Matched spots facing a bet: whether the player continued (call or raise) with a true chance at or
   * above the pot odds, or folded below them. Share right over this player's matched spots.
   */
  matchedDecision: { n: number; accuracy: number | null }
}

/** The focus player minus another on one measure, paired by neighbour block, Holm-corrected within the measure. */
export interface CalibrationContrast {
  measure: 'brierA' | 'matchedError' | 'matchedDecision'
  focusId: string
  otherId: string
  /** Mean over blocks of the per-block difference, with its 95% Student t CI (Brier; points of error for matchedError; points of accuracy for matchedDecision). */
  diff: Interval
  pValue: number | null
  pHolm: number | null
  significant: boolean
  /** Blocks in which both players had decisions to compare. */
  blocks: number
}

export interface CalibrationStatsInput {
  decisions: readonly ScoredDecision[]
  /** Duplicate group of every analysed hand. */
  groupOf: ReadonlyMap<string, number>
  /** Groups per neighbour block: the cluster everything is resampled and paired by. */
  blockSize: number
  players: readonly string[]
  focusId: string
  resamples: number
  seed: string
}

interface Point {
  p: number
  a: number
  c: number
  fair: number
}

const sq = (x: number) => x * x

/** Pooled Brier (A), its skill against the fair share, and ECE (C) over a set of points. */
function measures(points: readonly Point[]) {
  if (!points.length) return { brier: null, skill: null, ece: null }
  let brier = 0
  let reference = 0
  for (const x of points) {
    brier += sq(x.p - x.a)
    reference += sq(x.fair - x.a)
  }
  brier /= points.length
  reference /= points.length
  return {
    brier,
    skill: reference > 0 ? 1 - brier / reference : null,
    ece: calibration(points.map((x) => ({ p: x.p, o: x.c }))).ece,
  }
}

const percentile = (sorted: readonly number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!

/**
 * Calibration with uncertainty, the way the chip results have it: intervals from a bootstrap over
 * neighbour blocks (decisions from the same hands are not independent, so the block is the unit), and
 * paired comparisons of the focus with every other player on the same blocks, Holm-corrected.
 */
export function calibrationStats(input: CalibrationStatsInput): { players: PlayerCalibrationStats[]; contrasts: CalibrationContrast[] } {
  const spotOf = new Map<ScoredDecision, string>()
  const blockOf = (handId: string) => {
    const g = input.groupOf.get(handId)
    return g === undefined ? null : Math.floor(g / input.blockSize)
  }
  // Points by player and block; errors by player and spot, a spot being everything the player saw:
  // the group (same cards in every seat), the seat, and the actions before it, by seat. Stacks reset
  // every hand, so equal spots are equal states, boards and menus.
  const byBlock = new Map<string, Map<number, Point[]>>()
  const matched = new Map<string, Map<string, { group: number; error: number }>>()
  const decided = new Map<string, Map<string, { group: number; right: number }>>(input.players.map((id) => [id, new Map()]))
  const before = new Map<string, string[]>()
  for (const d of [...input.decisions].sort((x, y) => (x.handId < y.handId ? -1 : x.handId > y.handId ? 1 : x.index - y.index))) {
    const seen = before.get(d.handId) ?? []
    spotOf.set(d, `${input.groupOf.get(d.handId)}|${d.position}|${seen.join(',')}`)
    seen.push(`${d.position}:${d.optionId}`)
    before.set(d.handId, seen)
  }
  for (const id of input.players) {
    byBlock.set(id, new Map())
    matched.set(id, new Map())
  }
  for (const d of input.decisions) {
    // Decisions at a price, stated chance or not: continuing is right at or above the pot odds.
    if (!d.fallback && decided.has(d.playerId) && d.toCall > 0 && input.groupOf.has(d.handId)) {
      const odds = d.toCall / (d.winnablePot + d.toCall)
      const right = d.actionType === 'fold' ? d.expectedShare < odds : d.expectedShare >= odds
      decided.get(d.playerId)!.set(spotOf.get(d)!, { group: input.groupOf.get(d.handId)!, right: right ? 1 : 0 })
    }
    if (d.fallback || d.winProbability === null || !byBlock.has(d.playerId)) continue
    const b = blockOf(d.handId)
    if (b === null) continue
    const blocks = byBlock.get(d.playerId)!
    if (!blocks.has(b)) blocks.set(b, [])
    blocks.get(b)!.push({ p: d.winProbability, a: d.mainPotShare, c: d.expectedShare, fair: 1 / Math.max(1, d.live.length) })
    matched.get(d.playerId)!.set(spotOf.get(d)!, { group: input.groupOf.get(d.handId)!, error: Math.abs(d.winProbability - d.expectedShare) * 100 })
  }
  // A spot is matched when more than one player faced it.
  const facedBy = new Map<string, number>()
  for (const spots of matched.values()) for (const k of spots.keys()) facedBy.set(k, (facedBy.get(k) ?? 0) + 1)
  const pricedBy = new Map<string, number>()
  for (const spots of decided.values()) for (const k of spots.keys()) pricedBy.set(k, (pricedBy.get(k) ?? 0) + 1)
  const allBlocks = [...new Set([...byBlock.values()].flatMap((m) => [...m.keys()]))].sort((x, y) => x - y)

  // Cluster bootstrap: resample whole blocks, recompute every measure for every player.
  const rand = mulberry32(deriveSeed('calibration-bootstrap', input.seed))
  const draws = new Map<string, { brier: number[]; skill: number[]; ece: number[] }>(input.players.map((id) => [id, { brier: [], skill: [], ece: [] }]))
  if (allBlocks.length >= 2) {
    for (let r = 0; r < input.resamples; r++) {
      const picked = allBlocks.map(() => allBlocks[Math.floor(rand() * allBlocks.length)]!)
      for (const id of input.players) {
        const m = measures(picked.flatMap((b) => byBlock.get(id)!.get(b) ?? []))
        const out = draws.get(id)!
        if (m.brier !== null) out.brier.push(m.brier)
        if (m.skill !== null) out.skill.push(m.skill)
        if (m.ece !== null) out.ece.push(m.ece)
      }
    }
  }
  const estimate = (value: number | null, sample: number[]): Estimate => {
    if (value === null) return { value: null, low: null, high: null }
    if (sample.length < 2) return { value, low: null, high: null }
    const sorted = [...sample].sort((x, y) => x - y)
    return { value, low: percentile(sorted, 0.025), high: percentile(sorted, 0.975) }
  }

  const players = input.players.map((id): PlayerCalibrationStats => {
    const points = [...byBlock.get(id)!.values()].flat()
    const m = measures(points)
    const d = draws.get(id)!
    const errors = [...matched.get(id)!].filter(([k]) => facedBy.get(k)! > 1).map(([, x]) => x.error)
    const rights = [...decided.get(id)!].filter(([k]) => pricedBy.get(k)! > 1).map(([, x]) => x.right)
    return {
      playerId: id,
      n: points.length,
      brierA: estimate(m.brier, d.brier),
      skillA: estimate(m.skill, d.skill),
      eceC: estimate(m.ece, d.ece),
      matched: { n: errors.length, errorPts: errors.length ? errors.reduce((s, x) => s + x, 0) / errors.length : null },
      matchedDecision: { n: rights.length, accuracy: rights.length ? rights.reduce((s, x) => s + x, 0) / rights.length : null },
    }
  })

  // Paired contrasts: the focus minus each other player, one difference per block, t over blocks.
  const blockBrier = (id: string, b: number) => measures(byBlock.get(id)!.get(b) ?? []).brier
  // Mean difference over the spots both players faced in block b, from a per-spot value.
  const blockPaired = <T extends { group: number }>(spots: Map<string, Map<string, T>>, value: (x: T) => number, id: string, other: string, b: number) => {
    const diffs: number[] = []
    for (const [k, x] of spots.get(id)!) {
      if (Math.floor(x.group / input.blockSize) !== b) continue
      const o = spots.get(other)!.get(k)
      if (o !== undefined) diffs.push(value(x) - value(o))
    }
    return diffs.length ? diffs.reduce((s, x) => s + x, 0) / diffs.length : null
  }
  const contrasts: CalibrationContrast[] = []
  for (const measure of ['brierA', 'matchedError', 'matchedDecision'] as const) {
    const rows = input.players
      .filter((id) => id !== input.focusId)
      .map((other) => {
        const diffs: number[] = []
        for (const b of allBlocks) {
          if (measure === 'brierA') {
            const f = blockBrier(input.focusId, b)
            const o = blockBrier(other, b)
            if (f !== null && o !== null) diffs.push(f - o)
          } else {
            const x =
              measure === 'matchedError'
                ? blockPaired(matched, (v) => v.error, input.focusId, other, b)
                : blockPaired(decided, (v) => v.right * 100, input.focusId, other, b)
            if (x !== null) diffs.push(x)
          }
        }
        return { other, diffs, pValue: tTestPValue(diffs) }
      })
      // A player with nothing comparable (no stated chances, or fewer than two blocks) isn't compared.
      .filter((r) => r.diffs.length >= 2)
    const adjusted = holm(rows.map((r) => r.pValue))
    rows.forEach((r, i) =>
      contrasts.push({
        measure,
        focusId: input.focusId,
        otherId: r.other,
        diff: tInterval(r.diffs),
        pValue: r.pValue,
        pHolm: adjusted[i]!,
        significant: adjusted[i] !== null && adjusted[i]! < 0.05,
        blocks: r.diffs.length,
      }),
    )
  }
  return { players, contrasts }
}
