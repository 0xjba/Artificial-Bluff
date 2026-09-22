import type { StudyConfig } from './config'
import type { StudyProgress } from './progress'
import { blockValues } from './results'
import { studentTTail, tInterval, type Interval } from './stats'

/** Focus player minus another player, in bb/100, paired by neighbour block. */
export interface Contrast {
  focusId: string
  otherId: string
  /** Mean difference per block with its 95% Student t CI. */
  diff: Interval
  /** Two-sided paired t test p-value (null with fewer than 2 blocks). */
  pValue: number | null
  /** Holm-adjusted p-value across all contrasts of the focus player. */
  pHolm: number | null
  /** pHolm < 0.05. */
  significant: boolean
}

/** Holm step-down adjustment; nulls are ignored (and stay null). */
export function holm(pValues: readonly (number | null)[]): (number | null)[] {
  const ranked = pValues
    .map((p, i) => ({ p, i }))
    .filter((x): x is { p: number; i: number } => x.p !== null)
    .sort((a, b) => a.p - b.p)
  const m = ranked.length
  const out: (number | null)[] = pValues.map(() => null)
  let running = 0
  ranked.forEach(({ p, i }, k) => {
    running = Math.max(running, Math.min(1, (m - k) * p))
    out[i] = running
  })
  return out
}

/** Two-sided one-sample t test of mean 0. */
export function tTestPValue(values: readonly number[]): number | null {
  const n = values.length
  if (n < 2) return null
  const mean = values.reduce((s, v) => s + v, 0) / n
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1))
  if (sd === 0) return mean === 0 ? 1 : 0
  const t = Math.abs(mean) / (sd / Math.sqrt(n))
  return Math.min(1, 2 * studentTTail(t, n - 1))
}

/**
 * The focus player (Jev) against every other player: per-block bb/100 differences, a t CI and paired
 * t test for each, with Holm correction across the comparisons. This is how pairwise claims
 * ("Jev beat X") are made; the per-player CIs alone are marginal and don't support them.
 */
export function pairedContrasts(p: StudyProgress, config: StudyConfig, prefixGroups: number, focusId: string): Contrast[] {
  if (!config.lineup.some((s) => s.id === focusId)) throw new Error(`no player ${focusId} in the line-up`)
  const focus = blockValues(p, config, prefixGroups, focusId)
  const others = config.lineup.filter((s) => s.id !== focusId)
  const rows = others.map((s) => {
    const diffs = blockValues(p, config, prefixGroups, s.id).map((v, b) => focus[b]! - v)
    return { otherId: s.id, diff: tInterval(diffs), pValue: tTestPValue(diffs) }
  })
  const adjusted = holm(rows.map((r) => r.pValue))
  return rows.map((r, i) => ({ focusId, ...r, pHolm: adjusted[i]!, significant: adjusted[i] !== null && adjusted[i]! < 0.05 }))
}
