import { deriveSeed, mulberry32 } from '@ab/engine'
import { describe, expect, it } from 'vitest'
import { bootstrapMean, studentTQuantile, tInterval } from '../src/stats'

/** Student t with 3 df (fat-tailed, like poker results). */
function t3(rand: () => number): number {
  const normal = () => {
    const u = Math.max(rand(), 1e-12)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
  }
  const z = normal()
  const chi = normal() ** 2 + normal() ** 2 + normal() ** 2
  return z / Math.sqrt(chi / 3)
}

describe('studentTQuantile', () => {
  it('matches published t tables', () => {
    expect(studentTQuantile(0.975, 1)).toBeCloseTo(12.7062, 3)
    expect(studentTQuantile(0.975, 4)).toBeCloseTo(2.776445, 5)
    expect(studentTQuantile(0.975, 9)).toBeCloseTo(2.262157, 5)
    expect(studentTQuantile(0.975, 29)).toBeCloseTo(2.04523, 5)
    expect(studentTQuantile(0.975, 1000)).toBeCloseTo(1.962339, 4)
    expect(studentTQuantile(0.5, 7)).toBeCloseTo(0, 6)
  })
})

describe('tInterval', () => {
  it('computes mean ± t × standard error', () => {
    const ci = tInterval([1, 2, 3, 4, 5])
    // sd = 1.5811, se = 0.7071, t(0.975, 4) = 2.7764
    expect(ci.mean).toBe(3)
    expect(ci.halfWidth).toBeCloseTo(2.776445 * 0.707107, 4)
    expect(ci.low).toBeCloseTo(3 - ci.halfWidth, 10)
  })

  it('keeps about 95% coverage at 10 fat-tailed blocks (the regime a study stops in)', () => {
    let covered = 0
    for (let trial = 0; trial < 2000; trial++) {
      const rand = mulberry32(deriveSeed('cov-t', trial))
      const blocks = Array.from({ length: 10 }, () => t3(rand))
      const ci = tInterval(blocks)
      if (ci.low <= 0 && 0 <= ci.high) covered++
    }
    expect(covered / 2000).toBeGreaterThan(0.93)
  })

  it('is zero-width for identical values and infinite with fewer than two', () => {
    expect(tInterval([2, 2, 2]).halfWidth).toBe(0)
    expect(tInterval([3]).halfWidth).toBe(Number.POSITIVE_INFINITY)
  })

  it('rejects non-finite values', () => {
    expect(() => tInterval([1, Number.NaN])).toThrow(/finite/)
  })
})

describe('bootstrapMean (sensitivity check only)', () => {
  it('is deterministic for a seed, brackets the mean, and uses symmetric tails', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const a = bootstrapMean(values, 2000, 's')
    expect(bootstrapMean(values, 2000, 's')).toEqual(a)
    expect(a.mean).toBe(5.5)
    expect(a.low).toBeLessThan(5.5)
    expect(a.high).toBeGreaterThan(5.5)
  })

  it('undercovers at 10 fat-tailed blocks, which is why the study uses t', () => {
    let covered = 0
    for (let trial = 0; trial < 500; trial++) {
      const rand = mulberry32(deriveSeed('cov-b', trial))
      const blocks = Array.from({ length: 10 }, () => t3(rand))
      const ci = bootstrapMean(blocks, 1000, `b${trial}`)
      if (ci.low <= 0 && 0 <= ci.high) covered++
    }
    expect(covered / 500).toBeLessThan(0.93)
  })

  it('validates its inputs', () => {
    expect(() => bootstrapMean([1, 2], 10, 's')).toThrow(/resamples/)
    expect(() => bootstrapMean([1, 2], 1000, 's', 1.5)).toThrow(/level/)
  })
})
