import { describe, expect, it } from 'vitest'
import { parseStudyConfig } from '../src/config'

const lineup = ['jev', 'pill', 'block', 'drip', 'nimbus'].map((id) => ({ id, kind: 'mock' as const }))
const base = { id: 'pilot', lineup, masterSeed: 'm', budgetUsd: 5, targetHalfWidthBb100: 10, minGroups: 8, maxGroups: 40 }

describe('parseStudyConfig', () => {
  it('fills defaults', () => {
    expect(parseStudyConfig(base)).toMatchObject({
      format: { smallBlind: 50, bigBlind: 100, stackInBigBlinds: 100 },
      decisionTimeoutMs: 20_000,
      checkEvery: 20,
      concurrency: 2,
      bootstrapResamples: 2000,
    })
  })

  it('requires group counts in whole neighbour blocks (4 for 5 players)', () => {
    expect(() => parseStudyConfig({ ...base, minGroups: 6 })).toThrow(/multiple of the neighbour block \(4 for 5 players\)/)
    expect(() => parseStudyConfig({ ...base, checkEvery: 10 })).toThrow(/checkEvery/)
    expect(() => parseStudyConfig({ ...base, minGroups: 44 })).toThrow(/cannot exceed/)
  })

  it('rejects bad values', () => {
    expect(() => parseStudyConfig({ ...base, id: 'no spaces allowed' })).toThrow(/id/)
    expect(() => parseStudyConfig({ ...base, budgetUsd: 0 })).toThrow(/budgetUsd/)
    expect(() => parseStudyConfig({ ...base, budgetUsd: Number.NaN })).toThrow(/budgetUsd/)
    expect(() => parseStudyConfig({ ...base, lineup: [lineup[0], lineup[0]] })).toThrow(/unique/)
    expect(() => parseStudyConfig({ ...base, concurrency: 50 })).toThrow(/concurrency/)
  })
})
