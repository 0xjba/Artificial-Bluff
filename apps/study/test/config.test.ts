import { describe, expect, it } from 'vitest'
import { parseStudyConfig } from '../src/config'

const lineup = ['jev', 'pill', 'block', 'drip', 'nimbus'].map((id) => ({ id, kind: 'mock' as const }))
const base = { id: 'pilot', lineup, masterSeed: 'm', budgetUsd: 5, targetHalfWidthBb100: 10, minGroups: 40, maxGroups: 200 }

describe('parseStudyConfig', () => {
  it('fills defaults and ignores _-prefixed notes', () => {
    expect(parseStudyConfig({ ...base, _note: 'hello' })).toEqual({
      ...base,
      format: { smallBlind: 50, bigBlind: 100, stackInBigBlinds: 100 },
      decisionTimeoutMs: 20_000,
      checkEvery: 20,
      concurrency: 2,
      bootstrapResamples: 2000,
    })
  })

  it('rejects unknown keys, so typos cannot silently fall back to defaults', () => {
    expect(() => parseStudyConfig({ ...base, checkevery: 4 })).toThrow(/unknown key\(s\): checkevery/)
    expect(() => parseStudyConfig({ ...base, format: { smallBlind: 50, bigBlind: 100, stackInBigBlinds: 100, ante: 10 } })).toThrow(/unknown format key/)
  })

  it('requires group counts in whole neighbour blocks (4 for 5 players)', () => {
    expect(() => parseStudyConfig({ ...base, minGroups: 42 })).toThrow(/multiple of the neighbour block \(4 for 5 players\)/)
    expect(() => parseStudyConfig({ ...base, checkEvery: 10 })).toThrow(/checkEvery/)
    expect(() => parseStudyConfig({ ...base, minGroups: 44, maxGroups: 40 })).toThrow(/cannot exceed/)
  })

  it('requires at least 10 blocks before the CI rule may stop, unless the study has a fixed size', () => {
    expect(() => parseStudyConfig({ ...base, minGroups: 8 })).toThrow(/at least 10 neighbour blocks \(40 groups for 5 players\)/)
    expect(parseStudyConfig({ ...base, minGroups: 8, maxGroups: 8 }).minGroups).toBe(8)
  })

  it('validates every line-up seat', () => {
    const seat = (s: Record<string, unknown>) => ({ ...base, lineup: [...lineup.slice(0, 4), s] })
    expect(() => parseStudyConfig(seat({ id: 'x', kind: 'banana' }))).toThrow(/kind must be/)
    expect(() => parseStudyConfig(seat({ id: 'x', kind: 'llm' }))).toThrow(/model is required/)
    expect(() => parseStudyConfig(seat({ id: 'x', kind: 'bot', bot: 'calling_station' }))).toThrow(/bot must be/)
    expect(() => parseStudyConfig(seat({ id: '', kind: 'mock' }))).toThrow(/simple name/)
    expect(() => parseStudyConfig(seat({ id: 'x', kind: 'llm', model: 'm', reasoning: 'high' }))).toThrow(/reasoning/)
    // Unknown seat keys are dropped rather than pre-registered.
    expect(parseStudyConfig(seat({ id: 'x', kind: 'llm', model: 'm', color: 'red' })).lineup[4]).toEqual({ id: 'x', kind: 'llm', model: 'm' })
    expect(() => parseStudyConfig({ ...base, lineup: Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, kind: 'mock' })) })).toThrow(/2 to 10 players/)
  })

  it('validates the format and other values', () => {
    expect(() => parseStudyConfig({ ...base, format: { smallBlind: 100, bigBlind: 50, stackInBigBlinds: 100 } })).toThrow(/multiple of "format.smallBlind"/)
    expect(() => parseStudyConfig({ ...base, id: 'no spaces allowed' })).toThrow(/id/)
    expect(() => parseStudyConfig({ ...base, budgetUsd: 0 })).toThrow(/budgetUsd/)
    expect(() => parseStudyConfig({ ...base, budgetUsd: Number.NaN })).toThrow(/budgetUsd/)
    expect(() => parseStudyConfig({ ...base, lineup: [lineup[0], lineup[0]] })).toThrow(/unique/)
    expect(() => parseStudyConfig({ ...base, concurrency: 50 })).toThrow(/concurrency/)
    expect(() => parseStudyConfig({ ...base, bootstrapResamples: 200 })).toThrow(/bootstrapResamples/)
  })
})
