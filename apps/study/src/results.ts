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
  const block = neighbourBlockSize(config.lineup.length)
  const blocks = Math.floor(prefixGroups / block)
  const groups = blocks * block
  const players = config.lineup.map((spec): PlayerResult => {
    const values = blockValues(p, config, groups, spec.id)
    return {
      playerId: spec.id,
      bb100: tInterval(values),
      // Same seed for every player: resamples are joint, keeping the players' zero-sum correlation.
      bb100Bootstrap: bootstrapMean(values, config.bootstrapResamples, config.masterSeed),
      hands: groups * config.lineup.length,
    }
  })
  return { groups, blocks, players }
}

/**
 * A player's bb/100 in each whole neighbour block of the first `prefixGroups` groups. A group's
 * value is the player's net over all its rotations / rotations / big blind x 100.
 */
export function blockValues(p: StudyProgress, config: StudyConfig, prefixGroups: number, playerId: string): number[] {
  const n = config.lineup.length
  const block = neighbourBlockSize(n)
  const bb = config.format.bigBlind
  const values: number[] = []
  for (let b = 0; b < Math.floor(prefixGroups / block); b++) {
    let sum = 0
    for (let g = b * block; g < (b + 1) * block; g++) {
      let net = 0
      for (let r = 0; r < n; r++) {
        const hand = p.valid.get(handKeyOf(g, r))
        if (!hand) throw new Error(`group ${g} rotation ${r} has no valid hand`)
        net += hand[playerId] ?? 0
      }
      sum += (net / n / bb) * 100
    }
    values.push(sum / block)
  }
  return values
}
