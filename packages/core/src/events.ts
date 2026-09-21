import type { Action, Card, EndReason, HandCategory, OptionId, Position, Street } from '@ab/engine'
import type { PlayerKind } from '@ab/players'

export type GameKind = 'live' | 'study'

/** Where a study hand sits in the duplicate schedule. */
export interface DuplicateInfo {
  groupIndex: number
  rotation: number
  /** Base seating order of the group (multiplier k, or 0 for a seeded shuffle). */
  order: number
  /** Deck seed shared by the group's rotations. */
  seed: number
  /** 1 for the first try; a hand interrupted (crash, budget cap) is replayed with the next attempt. */
  attempt: number
}

/** Why a study stopped: CI target met, all groups played, budget reached, or stopped early. */
export type StudyEndReason = 'ci_target' | 'max_groups' | 'budget_cap' | 'interrupted'

export interface PlayerInfo {
  id: string
  kind: PlayerKind
  model: string
}

export interface DecisionEvent {
  type: 'decision'
  handId: string | null
  street: Street
  playerId: string
  position: Position
  /** Model that answered (as reported by the provider), or the configured one on failure. */
  model: string
  optionId: OptionId
  label: string
  /**
   * The engine action. A bet (no bet yet this street) is `{type: 'raise', to}` too: it's a bet when
   * `currentBet` was 0. It's all-in when `chipsIn` equals the seat's stack before acting.
   */
  action: Action
  /** Chips moved from the player's stack by this action. */
  chipsIn: number
  /** Pot before the action. */
  pot: number
  /**
   * Highest street commitment the player faced before acting. Preflop this is the full big blind
   * even when the big blind posted short (it was all-in), so rebuild state from this, not from posts.
   */
  currentBet: number
  toCall: number
  winProbability: number | null
  confidence: number | null
  optionProbabilities: Partial<Record<OptionId, number>> | null
  reasoning: string | null
  latencyMs: number
  inputTokens: number
  outputTokens: number
  /** Hidden reasoning tokens among outputTokens (evidence that reasoning was really off). */
  reasoningTokens: number
  costUsd: number
  retries: number
  /** True when the runner substituted check-or-fold for the player's answer. */
  fallback: boolean
  /**
   * Who is to blame, so provider outages aren't counted against a model:
   * 'model' (invalid/truncated/empty output or an option not offered), 'infra' (HTTP, network,
   * provider, config), 'timeout', or 'auto' (skipped after repeated failures).
   */
  fallbackKind: FallbackKind | null
  /** The player's error, "timeout", "invalid option: x", or "auto: too many failures". */
  fallbackReason: string | null
}

export type FallbackKind = 'model' | 'infra' | 'timeout' | 'auto'

export type EventBody =
  | { type: 'game_started'; kind: GameKind; players: PlayerInfo[]; /** Pre-registration hash of the game config. */ configHash: string }
  | {
      type: 'hand_started'
      handId: string | null
      buttonIndex: number
      smallBlind: number
      bigBlind: number
      seats: Array<{ playerId: string; stack: number; position: Position }>
      posts: Array<{ playerId: string; blind: 'sb' | 'bb'; amount: number }>
      /** Study hands only. */
      duplicate?: DuplicateInfo
    }
  | { type: 'cards_dealt'; handId: string | null; holes: Record<string, Card[]> }
  | { type: 'turn_started'; handId: string | null; playerId: string; options: Array<{ id: OptionId; label: string }> }
  | DecisionEvent
  | { type: 'street_dealt'; handId: string | null; street: Street; cards: Card[]; board: Card[] }
  | {
      type: 'showdown'
      handId: string | null
      hands: Record<string, { hole: Card[]; category: HandCategory; label: string; value: number }>
    }
  | { type: 'pot_awarded'; handId: string | null; amount: number; eligible: string[]; winners: string[]; shares: Record<string, number> }
  | { type: 'hand_ended'; handId: string | null; stacks: Record<string, number>; net: Record<string, number> }
  | {
      type: 'game_ended'
      reason: EndReason
      winner: string | null
      stacks: Record<string, number>
      eliminated: string[]
      handsPlayed: number
    }
  | {
      type: 'study_checkpoint'
      /**
       * The check's boundary: groups 0..groups-1 (a multiple of checkEvery, or maxGroups). Checks run at
       * every boundary in order, whatever the concurrency or resumes, and each is logged once.
       */
      groups: number
      blocks: number
      costUsd: number
      /** 95% Student t CI of bb/100 per player; null where not yet defined (fewer than 2 blocks). */
      players: Array<{ playerId: string; bb100: number | null; low: number | null; high: number | null; halfWidth: number | null }>
      /** Whether the stopping rule was met here (it then ends the study, even after a budget cap). */
      stop: boolean
    }
  | {
      type: 'study_ended'
      reason: StudyEndReason
      /** Seed groups completed in order from group 0. */
      groupsCompleted: number
      /**
       * Groups the results use: the stopping boundary for 'ci_target' (hands still in flight when
       * the rule was met are not included), otherwise groupsCompleted cut to whole neighbour blocks.
       */
      analysedGroups: number
      handsPlayed: number
      costUsd: number
    }

export type EventType = EventBody['type']

export type GameEvent = EventBody & { gameId: string; seq: number; ts: number }

/** Where the runner writes events. The store assigns seq and ts. */
export interface EventSink {
  append(body: EventBody): GameEvent
}
