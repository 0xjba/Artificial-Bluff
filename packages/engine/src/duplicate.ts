import { deriveSeed, shuffle } from './rng'
import type { HandConfig } from './types'

function isPrime(n: number): boolean {
  if (n < 2) return false
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false
  return true
}

/**
 * Number of consecutive seed groups that together balance who sits next to whom.
 * For a prime player count n, the n-1 multiplier orders put every ordered pair of players
 * side by side exactly once. Otherwise each group uses a seeded random order (block size 1).
 */
export function neighbourBlockSize(playerCount: number): number {
  return isPrime(playerCount) ? playerCount - 1 : 1
}

/**
 * Base seating for a group. Prime n: multiplier k = 1 + (group mod (n-1)) seats
 * players[(k * i) mod n] in seat i. Otherwise: a shuffle seeded by the group seed.
 * Returns the seating and the order id recorded with each hand (k, or 0 for a shuffle).
 */
export function baseSeating(
  players: readonly string[],
  groupIndex: number,
  groupSeed: number,
): { seating: string[]; order: number } {
  const n = players.length
  if (isPrime(n)) {
    const k = 1 + (groupIndex % (n - 1))
    return { seating: Array.from({ length: n }, (_, i) => players[(k * i) % n]!), order: k }
  }
  return { seating: shuffle(players, groupSeed), order: 0 }
}

/**
 * Cyclic seat rotations: rotation r puts seating[(i + r) % n] in seat i.
 * Across n rotations every player sits in every seat exactly once.
 */
export function seatRotations<T>(seating: readonly T[]): T[][] {
  const n = seating.length
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, i) => seating[(i + r) % n]!))
}

export interface DuplicateHand {
  groupIndex: number
  rotation: number
  /** Base seating order used by this group (multiplier k, or 0 for a seeded shuffle). */
  order: number
  /** Deck seed, shared by every rotation in the group. */
  seed: number
  /** Player ids in seat order for this rotation. */
  readonly seating: readonly string[]
}

/** Stable key for resume and reporting: "<groupIndex>:<rotation>". */
export function handKey(hand: Pick<DuplicateHand, 'groupIndex' | 'rotation'>): string {
  return `${hand.groupIndex}:${hand.rotation}`
}

/** One seed group: the same deck played once per rotation of the group's base seating. */
export function duplicateGroup(masterSeed: string, groupIndex: number, players: readonly string[]): DuplicateHand[] {
  if (!Number.isInteger(groupIndex) || groupIndex < 0 || groupIndex > 0x7fffffff) {
    throw new Error('groupIndex must be an integer in [0, 2^31)')
  }
  if (players.length < 2) throw new Error('duplicate needs at least 2 players')
  if (new Set(players).size !== players.length) throw new Error('player ids must be unique')
  // Namespace hash + group counter: distinct groups always get distinct decks (no hash collisions).
  // (Another namespace's counter range could overlap this one with probability ~groups / 2^32.)
  const seed = (deriveSeed(masterSeed, 'groups') + groupIndex) >>> 0
  const { seating, order } = baseSeating(players, groupIndex, deriveSeed(masterSeed, 'seating', groupIndex))
  return seatRotations(seating).map((s, rotation) => ({ groupIndex, rotation, order, seed, seating: s }))
}

export interface CashFormat {
  smallBlind: number
  bigBlind: number
  /** Stack reset every hand, in big blinds. */
  stackInBigBlinds: number
}

export const STUDY_CASH: CashFormat = { smallBlind: 50, bigBlind: 100, stackInBigBlinds: 100 }

/** Hand config for one duplicate hand: fresh equal stacks, button fixed at seat 0. */
export function cashHandConfig(hand: DuplicateHand, format: CashFormat = STUDY_CASH): HandConfig {
  return {
    seats: hand.seating.map((id) => ({ id, stack: format.stackInBigBlinds * format.bigBlind })),
    buttonIndex: 0,
    smallBlind: format.smallBlind,
    bigBlind: format.bigBlind,
    seed: hand.seed,
  }
}
