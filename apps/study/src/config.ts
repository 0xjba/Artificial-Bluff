import { neighbourBlockSize, STUDY_CASH, type CashFormat } from '@ab/engine'
import type { PlayerSpec } from '@ab/players'

/** A study, as written in a JSON file. Everything here is pre-registered (hashed before hand 1). */
export interface StudyConfig {
  /** Study id; also the game id in the event store. */
  id: string
  /** Seats, one player each. Identical line-up on every hand; seating rotates. */
  lineup: PlayerSpec[]
  /** Master seed for deck seeds, seating shuffles and the bootstrap. */
  masterSeed: string
  /** Cash format; defaults to 50/100 blinds, 100 bb stacks. */
  format: CashFormat
  /** Per-decision time limit. */
  decisionTimeoutMs: number
  /** Hard spending cap (USD), checked before every decision. */
  budgetUsd: number
  /** Stop when every player's 95% CI half-width for bb/100 is at most this. */
  targetHalfWidthBb100: number
  /** Never stop on the CI before this many groups (a multiple of the neighbour block). */
  minGroups: number
  /** Stop after this many groups (a multiple of the neighbour block). */
  maxGroups: number
  /** Check the stopping rule every this many completed groups (a multiple of the neighbour block). */
  checkEvery: number
  /** Hands played at once. */
  concurrency: number
  /** Bootstrap resamples for the CIs. */
  bootstrapResamples: number
}

type Raw = Record<string, unknown>

function num(raw: Raw, key: string, fallback?: number): number {
  const v = raw[key] ?? fallback
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`study config: "${key}" must be a finite number`)
  return v
}

function int(raw: Raw, key: string, min: number, fallback?: number): number {
  const v = num(raw, key, fallback)
  if (!Number.isInteger(v) || v < min) throw new Error(`study config: "${key}" must be an integer ≥ ${min}`)
  return v
}

/** Parses and validates a study config (from JSON), filling defaults. */
export function parseStudyConfig(input: unknown): StudyConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('study config must be a JSON object')
  const raw = input as Raw
  if (typeof raw.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(raw.id)) throw new Error('study config: "id" must be a simple name')
  if (typeof raw.masterSeed !== 'string' || raw.masterSeed === '') throw new Error('study config: "masterSeed" must be a non-empty string')
  if (!Array.isArray(raw.lineup) || raw.lineup.length < 2) throw new Error('study config: "lineup" needs at least 2 players')
  const lineup = raw.lineup as PlayerSpec[]
  const ids = lineup.map((p) => p?.id)
  if (ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error('study config: lineup ids must be unique strings')

  const format = (raw.format ?? STUDY_CASH) as CashFormat
  for (const k of ['smallBlind', 'bigBlind', 'stackInBigBlinds'] as const) {
    if (!Number.isInteger(format[k]) || format[k] <= 0) throw new Error(`study config: "format.${k}" must be a positive integer`)
  }

  const block = neighbourBlockSize(lineup.length)
  const config: StudyConfig = {
    id: raw.id,
    lineup,
    masterSeed: raw.masterSeed,
    format,
    decisionTimeoutMs: int(raw, 'decisionTimeoutMs', 1000, 20_000),
    budgetUsd: num(raw, 'budgetUsd'),
    targetHalfWidthBb100: num(raw, 'targetHalfWidthBb100'),
    minGroups: int(raw, 'minGroups', block),
    maxGroups: int(raw, 'maxGroups', block),
    checkEvery: int(raw, 'checkEvery', block, 20),
    concurrency: int(raw, 'concurrency', 1, 2),
    bootstrapResamples: int(raw, 'bootstrapResamples', 200, 2000),
  }
  if (config.budgetUsd <= 0) throw new Error('study config: "budgetUsd" must be positive')
  if (config.targetHalfWidthBb100 <= 0) throw new Error('study config: "targetHalfWidthBb100" must be positive')
  if (config.concurrency > 16) throw new Error('study config: "concurrency" must be at most 16')
  for (const k of ['minGroups', 'maxGroups', 'checkEvery'] as const) {
    if (config[k] % block !== 0) throw new Error(`study config: "${k}" must be a multiple of the neighbour block (${block} for ${lineup.length} players)`)
  }
  if (config.minGroups > config.maxGroups) throw new Error('study config: "minGroups" cannot exceed "maxGroups"')
  return config
}
