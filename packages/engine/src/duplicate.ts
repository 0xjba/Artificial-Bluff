import { deriveSeed } from './rng'
import type { HandConfig } from './types'

/**
 * Cyclic seat rotations: rotation r puts players[(i + r) % n] in seat i.
 * Across n rotations every player sits in every seat exactly once.
 */
export function seatRotations<T>(players: readonly T[]): T[][] {
  const n = players.length
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, i) => players[(i + r) % n]!))
}

export interface DuplicateHand {
  groupIndex: number
  rotation: number
  /** Deck seed, shared by every rotation in the group. */
  seed: number
  /** Player ids in seat order for this rotation. */
  seating: string[]
}

/** One seed group: the same deck played once per rotation. */
export function duplicateGroup(masterSeed: string, groupIndex: number, players: readonly string[]): DuplicateHand[] {
  // Namespace hash + group counter: distinct groups always get distinct decks (no hash collisions).
  const seed = (deriveSeed(masterSeed, 'groups') + groupIndex) >>> 0
  return seatRotations(players).map((seating, rotation) => ({ groupIndex, rotation, seed, seating }))
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
