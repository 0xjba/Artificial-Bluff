import { deriveSeed, mulberry32 } from '@ab/engine'

export interface Interval {
  mean: number
  low: number
  high: number
  /** (high - low) / 2 */
  halfWidth: number
}

const INFINITE = (mean: number): Interval => ({
  mean,
  low: Number.NEGATIVE_INFINITY,
  high: Number.POSITIVE_INFINITY,
  halfWidth: Number.POSITIVE_INFINITY,
})

function checkInputs(values: readonly number[], level: number): void {
  if (!(level > 0 && level < 1)) throw new Error('level must be between 0 and 1')
  if (values.some((v) => !Number.isFinite(v))) throw new Error('values must be finite numbers')
}

/** log Γ(x) (Lanczos approximation). */
function logGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]
  let y = x
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5)
  let ser = 1.000000000190015
  for (const k of c) ser += k / ++y
  return -tmp + Math.log((2.5066282746310005 * ser) / x)
}

/** Continued fraction for the incomplete beta function (Numerical Recipes betacf). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300
  let c = 1
  let d = 1 - ((a + b) * x) / (a + 1)
  if (Math.abs(d) < tiny) d = tiny
  d = 1 / d
  let h = d
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < 1e-14) break
  }
  return h
}

/** Regularized incomplete beta I_x(a, b). */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2) ? (front * betaContinuedFraction(a, b, x)) / a : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b
}

/** Student t CDF with `df` degrees of freedom. */
export function studentTCdf(t: number, df: number): number {
  const tail = 0.5 * incompleteBeta(df / (df + t * t), df / 2, 0.5)
  return t >= 0 ? 1 - tail : tail
}

/** Student t quantile (inverse CDF) by bisection; accurate to ~1e-10. */
export function studentTQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1)) throw new Error('p must be between 0 and 1')
  if (!(df > 0)) throw new Error('df must be positive')
  let lo = -1e4
  let hi = 1e4
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (studentTCdf(mid, df) < p) lo = mid
    else hi = mid
    if (hi - lo < 1e-12) break
  }
  return (lo + hi) / 2
}

/**
 * Mean with a Student t CI (df = n - 1). Used for the stopping rule and the published CIs: it keeps
 * close to nominal coverage at the small block counts a study stops at, where percentile bootstraps
 * are too narrow.
 */
export function tInterval(values: readonly number[], level = 0.95): Interval {
  checkInputs(values, level)
  const n = values.length
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : Number.NaN
  if (n < 2) return INFINITE(mean)
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)
  const halfWidth = studentTQuantile(1 - (1 - level) / 2, n - 1) * Math.sqrt(variance / n)
  return { mean, low: mean - halfWidth, high: mean + halfWidth, halfWidth }
}

/**
 * Mean of `values` with a percentile bootstrap CI (resampling the values with replacement).
 * Reported as a sensitivity check only: it undercovers at small counts.
 */
export function bootstrapMean(values: readonly number[], resamples: number, seed: string, level = 0.95): Interval {
  checkInputs(values, level)
  if (!Number.isInteger(resamples) || resamples < 100) throw new Error('resamples must be an integer ≥ 100')
  const n = values.length
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : Number.NaN
  if (n < 2) return INFINITE(mean)
  const rand = mulberry32(deriveSeed('bootstrap', seed))
  const means = new Array<number>(resamples)
  for (let r = 0; r < resamples; r++) {
    let sum = 0
    for (let i = 0; i < n; i++) sum += values[Math.floor(rand() * n)]!
    means[r] = sum / n
  }
  means.sort((a, b) => a - b)
  // Symmetric order statistics: k from each end.
  const k = Math.max(1, Math.floor((resamples + 1) * ((1 - level) / 2) + 1e-9))
  const low = means[k - 1]!
  const high = means[resamples - k]!
  return { mean, low, high, halfWidth: (high - low) / 2 }
}
