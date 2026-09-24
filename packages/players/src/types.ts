import type { Card, OptionId, Position, Street } from '@ab/engine'

export interface SeatView {
  position: Position
  /** Chips behind (not yet committed). */
  stack: number
  status: 'active' | 'folded' | 'all_in'
  /** Chips put in on the current street. */
  bet: number
  /** True for the player who is to act. Opponents are identified only by position. */
  you: boolean
}

/** Arithmetic computed by code so no player has to do it. */
export interface Facts {
  smallBlind: number
  bigBlind: number
  /** All chips in the middle, including this street's bets. */
  pot: number
  /** Chips needed to call, capped at your stack (a call for less is all-in). */
  toCall: number
  /**
   * toCall / (winnable pot + toCall) as a percentage, one decimal; 0 when nothing to call.
   * The winnable pot counts each player's chips only up to what you can match.
   */
  potOddsPct: number
  /** Effective stack at the start of this street (smaller of yours and the largest live opponent's), in big blinds, one decimal. */
  effectiveStackBb: number
  /** Effective stack / pot at the start of this street, one decimal; null preflop. Fixed for the whole street. */
  spr: number | null
}

export interface ObservedOption {
  id: OptionId
  label: string
}

/** Everything a player sees at a decision. Identical for every kind of player. */
export interface Observation {
  street: Street
  position: Position
  hole: Card[]
  board: Card[]
  seats: SeatView[]
  /** This hand's actions so far, e.g. "preflop: UTG raises to 300". */
  history: string[]
  facts: Facts
  options: ObservedOption[]
}

export interface Decision {
  optionId: OptionId
  /** Stated probability of winning this hand, 0-1, or null if the player gives none. */
  winProbability: number | null
  /**
   * 0-1, or null. Not comparable across player kinds: for Jev it is TypeSafe's confidence (how
   * concentrated its option probabilities are); for LLMs it is self-reported certainty that the
   * action is best. Report them separately.
   */
  confidence: number | null
  /** Probability per offered option (Jev), or null. */
  optionProbabilities: Partial<Record<OptionId, number>> | null
  /** Short free-text reasoning (LLMs), or null. */
  reasoning: string | null
  /** Jev only: TypeSafe's own pick, before `chooseMove` settles the move played. */
  jevChoice?: OptionId
}

export interface Usage {
  inputTokens: number
  /** Billed output tokens, including any reasoning tokens. */
  outputTokens: number
  /** Hidden reasoning ("thinking") tokens among outputTokens; 0 when the model didn't reason. */
  reasoningTokens: number
  costUsd: number
  /** Extra attempts made after the first (e.g. an invalid-output retry). */
  retries: number
}

export const NO_USAGE: Readonly<Usage> = Object.freeze({ inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, retries: 0 })

/**
 * Why a decision failed: the model answered badly ('model': invalid, truncated or empty output) or
 * the call itself failed ('infra': HTTP, network, provider or configuration errors).
 */
export type FailureKind = 'model' | 'infra'

/** A failed decision still reports what it cost: failed calls are billed too. */
/** What the call itself reported, kept in the log for the write-up. */
interface CallTrace {
  /** The host OpenRouter routed the call to (e.g. "Anthropic", "Fireworks"), when it says. */
  provider?: string | null
}

export type DecideResult =
  | ({ ok: true; decision: Decision; usage: Usage; model: string } & CallTrace)
  | ({
      ok: false
      error: string
      kind: FailureKind
      usage: Usage
      model: string
      /** What the model wrote when its answer couldn't be used (each attempt, bounded). */
      rawReply?: string
    } & CallTrace)

export type PlayerKind = 'jev' | 'llm' | 'bot' | 'mock'

export interface Player {
  readonly id: string
  readonly kind: PlayerKind
  /** Model id (or bot name) as configured. */
  readonly model: string
  /**
   * Must resolve for ordinary failures (returning `ok: false` with any usage incurred). Once `signal`
   * aborts (timeout), it should stop work and may reject: the runner has already recorded a timeout.
   */
  decide(obs: Observation, signal: AbortSignal): Promise<DecideResult>
}
