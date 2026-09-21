import { MAX_PLAYERS, neighbourBlockSize, STUDY_CASH, type CashFormat } from '@ab/engine'
import type { PlayerSpec } from '@ab/players'

/** A study, as written in a JSON file. Everything here except budget and concurrency is pre-registered. */
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
  /**
   * Spending cap (USD), checked before every hand and every decision. With several tables, decisions
   * already in flight when it is reached still finish (at most `concurrency` of them), and a call the
   * runner gave up on (timeout) may still be billed, so leave some headroom.
   */
  budgetUsd: number
  /** Stop when every player's 95% t CI half-width for bb/100 is at most this. */
  targetHalfWidthBb100: number
  /**
   * Never stop on the CI before this many groups. Must be at least 10 neighbour blocks (40 groups
   * for 5 players), unless the study has a fixed size (minGroups == maxGroups), and a multiple of
   * checkEvery, so the first check allowed to stop is exactly at minGroups.
   */
  minGroups: number
  /** Stop after this many groups (a multiple of the neighbour block). */
  maxGroups: number
  /** Check the stopping rule every this many completed groups (a multiple of the neighbour block). */
  checkEvery: number
  /** Hands played at once. */
  concurrency: number
  /** Bootstrap resamples for the sensitivity-check CIs. */
  bootstrapResamples: number
}

/** Minimum number of neighbour blocks before the CI stopping rule may fire. */
export const MIN_BLOCKS_BEFORE_STOPPING = 10

const KEYS = new Set([
  'id', 'lineup', 'masterSeed', 'format', 'decisionTimeoutMs', 'budgetUsd', 'targetHalfWidthBb100',
  'minGroups', 'maxGroups', 'checkEvery', 'concurrency', 'bootstrapResamples',
])
const NAME = /^[a-z0-9][a-z0-9._-]*$/i

type Raw = Record<string, unknown>

function num(raw: Raw, key: string, fallback?: number): number {
  const v = raw[key] ?? fallback
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`study config: "${key}" must be a finite number`)
  return v
}

function int(raw: Raw, key: string, min: number, fallback?: number, max = Number.MAX_SAFE_INTEGER): number {
  const v = num(raw, key, fallback)
  if (!Number.isInteger(v) || v < min || v > max) throw new Error(`study config: "${key}" must be an integer from ${min} to ${max}`)
  return v
}

/** Validates one line-up seat and returns it with only its known fields. */
function parseSeat(raw: unknown, index: number): PlayerSpec {
  const where = `lineup[${index}]`
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`study config: ${where} must be an object`)
  const s = raw as Raw
  if (typeof s.id !== 'string' || !NAME.test(s.id)) throw new Error(`study config: ${where}.id must be a simple name`)
  const model = () => {
    if (typeof s.model !== 'string' || s.model.trim() === '') throw new Error(`study config: ${where}.model is required for kind "${String(s.kind)}"`)
    return s.model
  }
  switch (s.kind) {
    case 'jev':
      return { id: s.id, kind: 'jev', model: model() }
    case 'llm': {
      const seat: PlayerSpec = { id: s.id, kind: 'llm', model: model() }
      if (s.reasoning !== undefined) {
        if (s.reasoning !== 'off' && s.reasoning !== 'low' && s.reasoning !== 'omit') throw new Error(`study config: ${where}.reasoning must be "off", "low" or "omit"`)
        seat.reasoning = s.reasoning
      }
      for (const flag of ['structuredOutput', 'sendTemperature'] as const) {
        if (s[flag] !== undefined) {
          if (typeof s[flag] !== 'boolean') throw new Error(`study config: ${where}.${flag} must be true or false`)
          seat[flag] = s[flag]
        }
      }
      return seat
    }
    case 'bot': {
      if (s.bot !== 'random' && s.bot !== 'calling-station' && s.bot !== 'tag') throw new Error(`study config: ${where}.bot must be "random", "calling-station" or "tag"`)
      if (s.seed !== undefined && !Number.isInteger(s.seed)) throw new Error(`study config: ${where}.seed must be an integer`)
      return { id: s.id, kind: 'bot', bot: s.bot, ...(s.seed !== undefined ? { seed: s.seed as number } : {}) }
    }
    case 'mock': {
      if (s.model !== undefined && (typeof s.model !== 'string' || s.model === '')) throw new Error(`study config: ${where}.model must be a non-empty string`)
      const price = s.inputPricePerMTok
      if (price !== undefined && (typeof price !== 'number' || !Number.isFinite(price) || price < 0)) throw new Error(`study config: ${where}.inputPricePerMTok must be ≥ 0`)
      return { id: s.id, kind: 'mock', ...(s.model !== undefined ? { model: s.model as string } : {}), ...(price !== undefined ? { inputPricePerMTok: price as number } : {}) }
    }
    default:
      throw new Error(`study config: ${where}.kind must be "jev", "llm", "bot" or "mock"`)
  }
}

function parseFormat(raw: unknown): CashFormat {
  if (raw === undefined) return { ...STUDY_CASH }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('study config: "format" must be an object')
  const f = raw as Raw
  const extra = Object.keys(f).filter((k) => !['smallBlind', 'bigBlind', 'stackInBigBlinds'].includes(k))
  if (extra.length) throw new Error(`study config: unknown format key(s): ${extra.join(', ')}`)
  const format = {
    smallBlind: int(f, 'smallBlind', 1),
    bigBlind: int(f, 'bigBlind', 1),
    stackInBigBlinds: int(f, 'stackInBigBlinds', 1),
  }
  if (format.smallBlind > format.bigBlind || format.bigBlind % format.smallBlind !== 0) {
    throw new Error('study config: "format.bigBlind" must be a multiple of "format.smallBlind"')
  }
  return format
}

/**
 * Parses and validates a study config (from JSON), filling defaults. Unknown keys are errors (keys
 * starting with "_", e.g. "_note", are ignored and not pre-registered), so a typo can't silently
 * fall back to a default that then gets pre-registered.
 */
export function parseStudyConfig(input: unknown): StudyConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('study config must be a JSON object')
  const raw = input as Raw
  const unknown = Object.keys(raw).filter((k) => !k.startsWith('_') && !KEYS.has(k))
  if (unknown.length) throw new Error(`study config: unknown key(s): ${unknown.join(', ')}`)
  if (typeof raw.id !== 'string' || !NAME.test(raw.id)) throw new Error('study config: "id" must be a simple name')
  if (typeof raw.masterSeed !== 'string' || raw.masterSeed === '') throw new Error('study config: "masterSeed" must be a non-empty string')
  if (!Array.isArray(raw.lineup) || raw.lineup.length < 2 || raw.lineup.length > MAX_PLAYERS) {
    throw new Error(`study config: "lineup" needs 2 to ${MAX_PLAYERS} players`)
  }
  const lineup = raw.lineup.map(parseSeat)
  if (new Set(lineup.map((p) => p.id)).size !== lineup.length) throw new Error('study config: lineup ids must be unique')

  const block = neighbourBlockSize(lineup.length)
  const config: StudyConfig = {
    id: raw.id,
    lineup,
    masterSeed: raw.masterSeed,
    format: parseFormat(raw.format),
    decisionTimeoutMs: int(raw, 'decisionTimeoutMs', 1000, 20_000, 300_000),
    budgetUsd: num(raw, 'budgetUsd'),
    targetHalfWidthBb100: num(raw, 'targetHalfWidthBb100'),
    minGroups: int(raw, 'minGroups', block),
    maxGroups: int(raw, 'maxGroups', block),
    checkEvery: int(raw, 'checkEvery', block, 20),
    concurrency: int(raw, 'concurrency', 1, 2, 16),
    bootstrapResamples: int(raw, 'bootstrapResamples', 1000, 2000),
  }
  if (config.budgetUsd <= 0) throw new Error('study config: "budgetUsd" must be positive')
  if (config.targetHalfWidthBb100 <= 0) throw new Error('study config: "targetHalfWidthBb100" must be positive')
  for (const k of ['minGroups', 'maxGroups', 'checkEvery'] as const) {
    if (config[k] % block !== 0) throw new Error(`study config: "${k}" must be a multiple of the neighbour block (${block} for ${lineup.length} players)`)
  }
  if (config.minGroups > config.maxGroups) throw new Error('study config: "minGroups" cannot exceed "maxGroups"')
  if (config.minGroups < MIN_BLOCKS_BEFORE_STOPPING * block && config.minGroups !== config.maxGroups) {
    throw new Error(
      `study config: "minGroups" must be at least ${MIN_BLOCKS_BEFORE_STOPPING} neighbour blocks ` +
        `(${MIN_BLOCKS_BEFORE_STOPPING * block} groups for ${lineup.length} players) so the CI stopping rule can't fire on too little data, ` +
        'unless the study has a fixed size (minGroups == maxGroups)',
    )
  }
  if (config.minGroups !== config.maxGroups && config.minGroups % config.checkEvery !== 0) {
    throw new Error('study config: "minGroups" must be a multiple of "checkEvery" (so a check falls exactly on it)')
  }
  return config
}
