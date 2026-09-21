import { deriveSeed, mulberry32 } from '@ab/engine'
import { describe, expect, it } from 'vitest'
import { bootstrapMean } from '../src/stats'

describe('bootstrapMean', () => {
  it('is deterministic for a seed and brackets the mean', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const a = bootstrapMean(values, 2000, 's')
    expect(bootstrapMean(values, 2000, 's')).toEqual(a)
    expect(a.mean).toBe(5.5)
    expect(a.low).toBeLessThan(5.5)
    expect(a.high).toBeGreaterThan(5.5)
    expect(a.halfWidth).toBeCloseTo((a.high - a.low) / 2)
  })

  it('has roughly the right coverage on synthetic data (about 95%)', () => {
    // True mean 0, sd 1, n = 40: the CI should contain 0 in roughly 95% of 400 trials.
    let covered = 0
    for (let t = 0; t < 400; t++) {
      const rand = mulberry32(deriveSeed('cov', t))
      const values = Array.from({ length: 40 }, () => {
        // Box-Muller normal
        const u = Math.max(rand(), 1e-12)
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
      })
      const ci = bootstrapMean(values, 1000, `b${t}`)
      if (ci.low <= 0 && 0 <= ci.high) covered++
    }
    expect(covered / 400).toBeGreaterThan(0.9)
    expect(covered / 400).toBeLessThan(0.98)
  })

  it('reports an infinite interval with fewer than two values', () => {
    expect(bootstrapMean([3], 1000, 's').halfWidth).toBe(Number.POSITIVE_INFINITY)
  })
})
