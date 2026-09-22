import { describe, expect, it } from 'vitest'
import { calibration, type CalibrationPoint } from '../src/calibration'

/** mulberry32: small seeded RNG for synthetic data. */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('calibration', () => {
  it('finds a perfectly calibrated fake player calibrated', () => {
    const r = rng(1)
    const points: CalibrationPoint[] = Array.from({ length: 50_000 }, () => {
      const p = r()
      return { p, o: r() < p ? 1 : 0 }
    })
    const c = calibration(points)
    expect(c.n).toBe(50_000)
    expect(c.ece!).toBeLessThan(0.01)
    expect(c.brier!).toBeCloseTo(1 / 6, 2) // E[p(1 - p)] for p ~ U(0, 1)
    for (const b of c.bins) expect(Math.abs(b.meanPredicted! - b.meanObserved!)).toBeLessThan(0.03)
  })

  it('measures an overconfident player exactly', () => {
    // Says 0.9 every time, is right 6 times in 10.
    const points = Array.from({ length: 10 }, (_, i) => ({ p: 0.9, o: i < 6 ? 1 : 0 }))
    const c = calibration(points)
    expect(c.ece).toBeCloseTo(0.3, 12)
    expect(c.brier).toBeCloseTo((6 * 0.01 + 4 * 0.81) / 10, 12)
    expect(c.bins[9]).toMatchObject({ n: 10, low: 0.9, high: 1 })
    expect(c.bins[9]!.meanPredicted).toBeCloseTo(0.9, 12)
    expect(c.bins[9]!.meanObserved).toBeCloseTo(0.6, 12)
    expect(c.bins[0]).toMatchObject({ n: 0, meanPredicted: null, meanObserved: null })
  })

  it('accepts fractional outcomes, puts p = 1 in the top bin, and validates input', () => {
    const c = calibration([
      { p: 1, o: 0.5 },
      { p: 0, o: 0 },
    ])
    expect(c.bins[9]!.n).toBe(1)
    expect(c.brier).toBeCloseTo(0.125, 12)
    expect(calibration([])).toMatchObject({ n: 0, brier: null, ece: null })
    expect(() => calibration([{ p: 1.2, o: 0 }])).toThrow(/\[0, 1\]/)
    expect(() => calibration([{ p: 0.5, o: Number.NaN }])).toThrow(/\[0, 1\]/)
    expect(() => calibration([], 0)).toThrow(/binCount/)
  })
})
