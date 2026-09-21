import { MAX_PLAYERS } from './hand'
import { deriveSeed } from './rng'
import type { HandConfig, HandResult } from './types'

export interface BlindLevel {
  smallBlind: number
  bigBlind: number
}

export const TURBO_LEVELS: BlindLevel[] = [
  { smallBlind: 25, bigBlind: 50 },
  { smallBlind: 50, bigBlind: 100 },
  { smallBlind: 75, bigBlind: 150 },
  { smallBlind: 100, bigBlind: 200 },
  { smallBlind: 150, bigBlind: 300 },
  { smallBlind: 200, bigBlind: 400 },
  { smallBlind: 300, bigBlind: 600 },
  { smallBlind: 400, bigBlind: 800 },
  { smallBlind: 600, bigBlind: 1200 },
  { smallBlind: 800, bigBlind: 1600 },
  { smallBlind: 1000, bigBlind: 2000 },
  { smallBlind: 1500, bigBlind: 3000 },
  { smallBlind: 2000, bigBlind: 4000 },
]

export interface TournamentConfig {
  startingStack: number
  levels: BlindLevel[]
  handsPerLevel: number
  /** Hard stop: after this many hands the chip leader wins. */
  maxHands: number
  /** Master seed; each hand's deck seed is derived from it. */
  seed: string
}

/** The live spectator format from the spec: 3,000 chips, blinds up every 8 hands, stop at hand 120. */
export function liveTurboConfig(seed: string): TournamentConfig {
  return { startingStack: 3000, levels: TURBO_LEVELS, handsPerLevel: 8, maxHands: 120, seed }
}

export type EndReason = 'last_player' | 'hand_cap' | 'budget_cap' | 'interrupted'

export interface TournamentPlayer {
  id: string
  stack: number
  /** 0-based index of the hand in which the player busted (i.e. `handNumber` before that hand was recorded). */
  eliminatedAtHand: number | null
}

export interface TournamentState {
  config: TournamentConfig
  /** Clockwise seat order; eliminated players stay in place with stack 0. */
  players: TournamentPlayer[]
  /** Hands completed so far. */
  handNumber: number
  /** Index into `players` of the button for the next hand. */
  buttonSeat: number
  complete: boolean
  winner: string | null
  endReason: EndReason | null
  /** Player ids in elimination order (first out first). */
  eliminated: string[]
}

export function createTournament(playerIds: string[], config: TournamentConfig): TournamentState {
  if (playerIds.length < 2) throw new Error('a tournament needs at least 2 players')
  if (playerIds.length > MAX_PLAYERS) throw new Error(`a tournament allows at most ${MAX_PLAYERS} players`)
  if (new Set(playerIds).size !== playerIds.length) throw new Error('player ids must be unique')
  if (config.levels.length === 0) throw new Error('a tournament needs at least one blind level')
  for (const level of config.levels) {
    if (
      !Number.isInteger(level.smallBlind) ||
      !Number.isInteger(level.bigBlind) ||
      level.smallBlind <= 0 ||
      level.bigBlind < level.smallBlind
    ) {
      throw new Error('invalid level blinds: must be positive integers with bigBlind >= smallBlind')
    }
  }
  if (!Number.isInteger(config.handsPerLevel) || config.handsPerLevel < 1) {
    throw new Error('handsPerLevel must be a positive integer')
  }
  if (!Number.isInteger(config.maxHands) || config.maxHands < 1) {
    throw new Error('maxHands must be a positive integer')
  }
  if (!Number.isInteger(config.startingStack) || config.startingStack < 1) {
    throw new Error('startingStack must be a positive integer')
  }

  const ownConfig = structuredClone(config)
  return {
    config: ownConfig,
    players: playerIds.map((id) => ({ id, stack: ownConfig.startingStack, eliminatedAtHand: null })),
    handNumber: 0,
    buttonSeat: 0,
    complete: false,
    winner: null,
    endReason: null,
    eliminated: [],
  }
}

export function currentLevel(t: TournamentState): BlindLevel {
  return t.config.levels[levelIndex(t)]!
}

export function levelIndex(t: TournamentState): number {
  return Math.min(Math.floor(t.handNumber / t.config.handsPerLevel), t.config.levels.length - 1)
}

export function nextHandConfig(t: TournamentState): HandConfig {
  if (t.complete) throw new Error('tournament is complete')
  const alive = t.players.filter((p) => p.stack > 0)
  const buttonId = t.players[t.buttonSeat]!.id
  const level = currentLevel(t)
  return {
    seats: alive.map((p) => ({ id: p.id, stack: p.stack })),
    buttonIndex: alive.findIndex((p) => p.id === buttonId),
    smallBlind: level.smallBlind,
    bigBlind: level.bigBlind,
    // Namespace hash + hand counter: every hand in a tournament gets a distinct deck seed.
    seed: (deriveSeed(t.config.seed, 'hands') + t.handNumber) >>> 0,
  }
}

function nextAliveSeat(t: TournamentState, from: number): number {
  const n = t.players.length
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n
    if (t.players[i]!.stack > 0) return i
  }
  return from
}

function chipLeader(t: TournamentState): string {
  let best = t.players[0]!
  for (const p of t.players) if (p.stack > best.stack) best = p
  return best.id
}

/** Applies a finished hand's stacks, eliminates busted players, rotates the button, checks for the end. */
export function recordHand(prev: TournamentState, result: HandResult): TournamentState {
  if (prev.complete) throw new Error('tournament is complete')
  // The result must come from the hand nextHandConfig dealt: exactly the live players, chips conserved.
  const dealt = prev.players.filter((p) => p.stack > 0)
  const ids = Object.keys(result.stacks)
  if (ids.length !== dealt.length || !dealt.every((p) => p.id in result.stacks)) {
    throw new Error(`hand result players [${ids.join(', ')}] do not match live players [${dealt.map((p) => p.id).join(', ')}]`)
  }
  const before = dealt.reduce((sum, p) => sum + p.stack, 0)
  const after = Object.values(result.stacks).reduce((sum, v) => sum + v, 0)
  if (before !== after) throw new Error(`hand result does not conserve chips: ${before} before, ${after} after`)

  const t = structuredClone(prev)
  const startStacks = new Map(t.players.map((p) => [p.id, p.stack]))
  for (const p of t.players) if (p.id in result.stacks) p.stack = result.stacks[p.id]!

  // Busted in the same hand: the one who started the hand with fewer chips finishes lower (goes out first).
  const busted = t.players
    .filter((p) => p.stack === 0 && p.eliminatedAtHand === null)
    .sort((a, b) => startStacks.get(a.id)! - startStacks.get(b.id)!)
  for (const p of busted) {
    p.eliminatedAtHand = t.handNumber
    t.eliminated.push(p.id)
  }

  t.handNumber += 1
  t.buttonSeat = nextAliveSeat(t, t.buttonSeat)

  const alive = t.players.filter((p) => p.stack > 0)
  if (alive.length <= 1) {
    t.complete = true
    t.winner = alive[0]?.id ?? chipLeader(t)
    t.endReason = 'last_player'
  } else if (t.handNumber >= t.config.maxHands) {
    return endTournament(t, 'hand_cap')
  }
  return t
}

/** Ends the tournament now; the chip leader (earliest seat on ties) wins. */
export function endTournament(prev: TournamentState, reason: Exclude<EndReason, 'last_player'>): TournamentState {
  const t = structuredClone(prev)
  t.complete = true
  t.winner = chipLeader(t)
  t.endReason = reason
  return t
}
