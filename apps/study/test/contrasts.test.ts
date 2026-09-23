import { describe, expect, it } from 'vitest'
import { parseStudyConfig } from '../src/config'
import { holm, pairedContrasts, tTestPValue } from '../src/contrasts'
import { emptyProgress, handKeyOf } from '../src/progress'

const ids = ['hex', 'pill', 'block', 'drip', 'nimbus']
const config = parseStudyConfig({
  id: 'c',
  lineup: ids.map((id) => ({ id, kind: 'mock' })),
  masterSeed: 'm',
  budgetUsd: 1,
  targetHalfWidthBb100: 1,
  minGroups: 8,
  maxGroups: 8,
  checkEvery: 4,
  bootstrapResamples: 1000,
})

describe('holm', () => {
  it('adjusts step-down and keeps monotone order, ignoring nulls', () => {
    const out = holm([0.01, 0.04, 0.03, null])
    expect(out[0]).toBeCloseTo(0.03, 12)
    expect(out[1]).toBeCloseTo(0.06, 12)
    expect(out[2]).toBeCloseTo(0.06, 12)
    expect(out[3]).toBeNull()
    const mono = holm([0.03, 0.02]) // 0.02 x 2 = 0.04; 0.03 x 1 = 0.03 is raised to the running maximum 0.04
    expect(mono[0]).toBeCloseTo(0.04, 12)
    expect(mono[1]).toBeCloseTo(0.04, 12)
    expect(holm([0.9, 0.8])).toEqual([1, 1]) // never above 1
  })
})

describe('tTestPValue', () => {
  it('matches a reference two-sided t test', () => {
    // R: t.test(1:5)$p.value = 0.01324 (t = 4.243, df = 4)
    expect(tTestPValue([1, 2, 3, 4, 5])!).toBeCloseTo(0.013236, 5)
    expect(tTestPValue([3, 3, 3])).toBe(0)
    expect(tTestPValue([0, 0])).toBe(1)
    expect(tTestPValue([5])).toBeNull()
    // A huge t still gives a tiny positive p (the tail is computed directly, not as 1 - cdf).
    const p = tTestPValue([10, 10.1, 9.9, 10, 10.05])!
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThan(1e-6)
  })
})

describe('pairedContrasts', () => {
  it('compares the focus player with each other player by block, with Holm correction', () => {
    const p = emptyProgress()
    // Every rotation of group g: hex wins (100 + g) chips from pill; block and drip trade 50 chips each way by group.
    for (let g = 0; g < 8; g++) {
      for (let r = 0; r < 5; r++) {
        const swing = g % 2 === 0 ? 50 : -50
        p.valid.set(handKeyOf(g, r), { hex: 100 + g, pill: -(100 + g), block: swing, drip: -swing, nimbus: 0 })
      }
    }
    const rows = pairedContrasts(p, config, 8, 'hex')
    expect(rows.map((r) => r.otherId)).toEqual(['pill', 'block', 'drip', 'nimbus'])
    const vsPill = rows[0]!
    // hex minus pill per group: 2 (100 + g) chips per rotation / 100 bb * 100 = 2 (100 + g) bb/100; blocks average groups 0-3 and 4-7.
    expect(vsPill.diff.mean).toBeCloseTo(2 * 103.5, 9)
    expect(vsPill.pValue).not.toBeNull()
    for (const r of rows) {
      expect(r.pHolm!).toBeGreaterThanOrEqual(r.pValue!)
      expect(r.significant).toBe(r.pHolm! < 0.05)
    }
    expect(() => pairedContrasts(p, config, 8, 'nobody')).toThrow(/no player nobody/)
  })
})
