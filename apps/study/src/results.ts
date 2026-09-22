import { neighbourBlockSize } from '@ab/engine'
import type { StudyConfig } from './config'
import { handKeyOf, type StudyProgress } from './progress'
import { bootstrapMean, tInterval, type Interval } from './stats'

export interface PlayerResult {
  playerId: string
  /** Big blinds won per 100 hands, with a 95% Student t CI over neighbour blocks (stopping rule, published). */
  bb100: Interval
  /** The same with a percentile bootstrap CI, reported only as a sensitivity check. */
  bb100Bootstrap: Interval
  hands: number
}

export interface StudySummary {
  /** Groups used: the completed prefix, truncated to whole neighbour blocks. */
  groups: number
  blocks: number
  players: PlayerResult[]
}

/**
 * bb/100 per player over the first `groups` groups (rounded down to whole blocks, so every
 * resample keeps the seating balance). Each group's result is the player's net over all rotations;
 * each player plays one hand per rotation.
 */
export function summarize(p: StudyProgress, config: StudyConfig, prefixGroups: number): StudySummary {
  const n = config.lineup.length
  const block = neighbourBlockSize(n)
  const blocks = Math.floor(prefixGroups / block)
  const groups = blocks * block
  const bb = config.format.bigBlind
  const players = config.lineup.map((spec): PlayerResult => {
    const blockValues: number[] = []
    for (let b = 0; b < blocks; b++) {
      let sum = 0
      for (let g = b * block; g < (b + 1) * block; g++) {
        let net = 0
        for (let r = 0; r < n; r++) net += p.valid.get(handKeyOf(g, r))![spec.id] ?? 0
        sum += (net / n / bb) * 100
      }
      blockValues.push(sum / block)
    }
    return {
      playerId: spec.id,
      bb100: tInterval(blockValues),
      // Same seed for every player: resamples are joint, keeping the players' zero-sum correlation.
      bb100Bootstrap: bootstrapMean(blockValues, config.bootstrapResamples, config.masterSeed),
      hands: groups * n,
    }
  })
  return { groups, blocks, players }
}
