export interface CalibrationPoint {
  /** Stated probability. */
  p: number
  /** Outcome in [0, 1] (a fraction for split pots or expected shares). */
  o: number
}

export interface ReliabilityBin {
  low: number
  high: number
  n: number
  /** null when the bin is empty. */
  meanPredicted: number | null
  meanObserved: number | null
}

export interface Calibration {
  n: number
  /** Mean squared error between stated probability and outcome; null with no points. */
  brier: number | null
  /** Expected calibration error: bin-size-weighted mean |mean predicted - mean observed|; null with no points. */
  ece: number | null
  bins: ReliabilityBin[]
}

/** Reliability curve (equal-width bins), Brier score and ECE. */
export function calibration(points: readonly CalibrationPoint[], binCount = 10): Calibration {
  if (!Number.isInteger(binCount) || binCount < 1) throw new Error('calibration: binCount must be a positive integer')
  for (const { p, o } of points) {
    if (!(p >= 0 && p <= 1) || !(o >= 0 && o <= 1)) throw new Error(`calibration: probabilities and outcomes must be in [0, 1], got p=${p}, o=${o}`)
  }
  const sums = Array.from({ length: binCount }, () => ({ n: 0, p: 0, o: 0 }))
  let squared = 0
  for (const { p, o } of points) {
    const b = sums[Math.min(Math.floor(p * binCount), binCount - 1)]!
    b.n++
    b.p += p
    b.o += o
    squared += (p - o) ** 2
  }
  const n = points.length
  const bins = sums.map((b, i) => ({
    low: i / binCount,
    high: (i + 1) / binCount,
    n: b.n,
    meanPredicted: b.n ? b.p / b.n : null,
    meanObserved: b.n ? b.o / b.n : null,
  }))
  const ece = n ? sums.reduce((acc, b) => acc + (b.n ? Math.abs(b.p / b.n - b.o / b.n) * b.n : 0), 0) / n : null
  return { n, brier: n ? squared / n : null, ece, bins }
}
