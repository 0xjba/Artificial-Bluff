import { deriveSeed, mulberry32 } from '@ab/engine'

export interface Interval {
  mean: number
  low: number
  high: number
  /** (high - low) / 2 */
  halfWidth: number
}

/** Mean of `values` with a percentile bootstrap CI (resampling the values with replacement). */
export function bootstrapMean(values: readonly number[], resamples: number, seed: string, level = 0.95): Interval {
  const n = values.length
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : Number.NaN
  if (n < 2) return { mean, low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY, halfWidth: Number.POSITIVE_INFINITY }
  const rand = mulberry32(deriveSeed('bootstrap', seed))
  const means = new Array<number>(resamples)
  for (let r = 0; r < resamples; r++) {
    let sum = 0
    for (let i = 0; i < n; i++) sum += values[Math.floor(rand() * n)]!
    means[r] = sum / n
  }
  means.sort((a, b) => a - b)
  const tail = (1 - level) / 2
  const pick = (q: number) => means[Math.min(resamples - 1, Math.max(0, Math.floor(q * resamples)))]!
  const low = pick(tail)
  const high = pick(1 - tail)
  return { mean, low, high, halfWidth: (high - low) / 2 }
}
