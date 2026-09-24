import { choice, noul, score, TypeSafeClient, type Questions, type TypeSafeClientConfig } from '@typesafe-ai/sdk'
import type { OptionId } from '@ab/engine'
import { OPTION_SEMANTICS, WIN_CONDITION } from '../llm/prompt'
import { checkOrFold } from '../bots'
import { NO_USAGE, type DecideResult, type Observation, type Player } from '../types'

/**
 * Question wording. Jev answers the question as literally written, so keep these exact and
 * change them only with a new pre-registration. The win definition and option semantics are the
 * same text the LLMs get, so both kinds of player answer the same questions.
 *
 * Disclosure: TypeSafe recommends splitting "what's the best action" into atomic questions combined
 * in code. For parity with the LLMs, the benchmark asks it as one Choice; a decomposed design is a
 * separate, pre-registered ablation.
 */
export const ACTION_INSTRUCTIONS =
  `You are the player marked "you": true in this No-Limit Texas Hold'em hand ("stack" is chips behind, ` +
  `"bet" is chips bet this street, "facts" are precomputed). ${OPTION_SEMANTICS} ` +
  'Which action maximises your expected chips?'
export const WIN_INSTRUCTIONS = `The player marked "you": true will ${WIN_CONDITION}.`

/**
 * Decomposed mode (TypeSafe's composite scoring): a second narrow question beside the win question,
 * and the move chosen in code from the two answers (see decomposedMove). Pre-registered.
 */
export const STRENGTH_INSTRUCTIONS =
  `You are the player marked "you": true in this No-Limit Texas Hold'em hand ("facts" are precomputed). ` +
  'How strong is your hand against the hands the opponents still in are likely to hold, given the board and the betting so far?'
export const STRENGTH_LEVELS = [
  'Very weak: behind almost every hand still in',
  'Weak: behind most hands still in',
  'Marginal: about even with the hands still in',
  'Strong: ahead of most hands still in',
  'Very strong: ahead of almost every hand still in',
] as const
/** Bet or raise only with at least this strength (0-4: "Strong")... */
export const AGGRESSION_STRENGTH = 3
/** ...and a chance of winning at least this far above a fair share (1 / players still in). */
export const AGGRESSION_EDGE = 0.15
/** Bet and raise sizes, most preferred first; the menu offers only those that fit the spot. */
export const SIZE_PREFERENCE = ['open_3bb', 'open_2_5bb', 'open_4bb', 'reraise_3x', 'reraise_2_5x', 'pot_75', 'pot_50', 'pot_100', 'pot_33', 'min_raise', 'all_in'] as const
/** The rule, as the pre-registration states it. */
export const DECOMPOSED_RULE =
  'fold when the stated win chance is below the pot odds; bet or raise when the hand strength score is at least 3 ' +
  `("Strong") and the win chance is at least ${AGGRESSION_EDGE * 100} points above a fair share (1 / players still in); ` +
  `otherwise check or call. Size: the first offered of ${SIZE_PREFERENCE.join(', ')}`

/** The move decomposed Jev plays, from its win chance and hand strength (0-4), decided in code. */
export function decomposedMove(obs: Observation, win: number, strength: number): OptionId {
  const offered = new Set(obs.options.map((o) => o.id))
  const live = obs.seats.filter((s) => s.status !== 'folded').length
  const aggressive = strength >= AGGRESSION_STRENGTH && win >= 1 / live + AGGRESSION_EDGE
  const size = aggressive ? SIZE_PREFERENCE.find((id) => offered.has(id)) : undefined
  if (obs.facts.toCall > 0) {
    if (win < obs.facts.potOddsPct / 100) return offered.has('fold') ? 'fold' : checkOrFold(obs)
    if (size) return size
    return offered.has('call') ? 'call' : checkOrFold(obs)
  }
  return size ?? checkOrFold(obs)
}

/**
 * USD per 1M input tokens; output tokens are free. Source: TypeSafe, "Introducing System One Models &
 * Jev" (https://typesafe.ai/blog/introducing-system-one-models-and-jev), read 2026-09-21:
 * "$0.042 / MTok" input, output "FREE (too cheap to meter)". Recorded in every game's config.
 */
export const JEV_INPUT_PRICE_PER_MTOK = 0.042

/** The kind of move an option is: sizes of the same bet or raise are one kind. */
const kindOf = (id: string): 'fold' | 'passive' | 'aggressive' => (id === 'fold' ? 'fold' : id === 'check' || id === 'call' ? 'passive' : 'aggressive')

/**
 * The move Jev's answer stands for. The Choice spreads its weight over every option offered, and raising
 * comes in several sizes while calling is one option, so the single most likely option under-counts
 * raising: 52% on raising over four sizes loses to 42% on calling. First the kind of move with the most
 * total weight (fold, check or call, bet or raise), then the most likely option of that kind. Ties keep
 * TypeSafe's own choice. Stated in the pre-registration.
 */
export function chooseMove(probabilities: Partial<Record<string, number>>, jevChoice: string): string {
  const entries = Object.entries(probabilities).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]))
  if (entries.length === 0) return jevChoice
  const weight = new Map<string, number>()
  for (const [id, p] of entries) weight.set(kindOf(id), (weight.get(kindOf(id)) ?? 0) + p)
  const own = kindOf(jevChoice)
  let kind = own
  for (const [k, w] of weight) if (w > (weight.get(kind) ?? 0)) kind = k as typeof kind
  let best = kind === own ? jevChoice : null
  let bestP = best === null ? -Infinity : (probabilities[best] ?? 0)
  for (const [id, p] of entries) if (kindOf(id) === kind && p > bestP) [best, bestP] = [id, p]
  return best ?? jevChoice
}

export interface JevPlayerOptions {
  id: string
  /** Pinned model version, e.g. "jev-1.13.0". The model that answered is recorded per decision. */
  model: string
  /** 'choice' (default): one Choice over the options. 'decomposed': a win Noul and a strength Score, the move chosen in code. */
  mode?: 'choice' | 'decomposed'
  /** Passed to TypeSafeClient (apiKey, fetch for tests, etc.). */
  client?: TypeSafeClientConfig
  /** USD per 1M input tokens (default JEV_INPUT_PRICE_PER_MTOK); output is free. */
  inputPricePerMTok?: number
  /**
   * SDK per-attempt timeout (ms). Kept above the table's decision timeout so the same runner timeout
   * governs Jev and the LLMs. Default 60 s.
   */
  timeoutMs?: number
}

/**
 * The Jev seat: one systemOne call per decision, a Choice over the offered options plus a win Noul.
 * No SDK retries: the LLM seats get no infrastructure retry either, so failures are treated alike.
 */
export class JevPlayer implements Player {
  readonly kind = 'jev' as const
  readonly id: string
  readonly model: string
  readonly mode: 'choice' | 'decomposed'
  // ES-private so the API key can't leak through JSON.stringify or console.log of a player.
  readonly #options: JevPlayerOptions
  readonly #client: TypeSafeClient

  constructor(options: JevPlayerOptions) {
    this.#options = options
    this.id = options.id
    this.model = options.model
    this.#client = new TypeSafeClient({ defaultModel: options.model, ...options.client })
    this.mode = options.mode ?? 'choice'
  }

  async decide(obs: Observation, signal: AbortSignal): Promise<DecideResult> {
    const { options, ...state } = obs
    const decomposed = this.#options.mode === 'decomposed'
    const criteria = Object.fromEntries(options.map((o) => [o.id, o.label]))
    const questions: Questions = decomposed
      ? { win: noul(WIN_INSTRUCTIONS), strength: score(STRENGTH_INSTRUCTIONS, STRENGTH_LEVELS) }
      : { action: choice(ACTION_INSTRUCTIONS, criteria), win: noul(WIN_INSTRUCTIONS) }
    let res
    try {
      res = await this.#client.systemOne(
        { model: this.model, state: JSON.parse(JSON.stringify(state)), questions },
        { signal, timeout: this.#options.timeoutMs ?? 60_000, retry: { maxRetries: 0 } },
      )
    } catch (e) {
      return { ok: false, error: (e as Error).message, kind: 'infra', usage: NO_USAGE, model: this.model }
    }
    if (!res || typeof res !== 'object' || !res.usage || !res.answers) {
      return { ok: false, error: 'malformed API response', kind: 'infra', usage: NO_USAGE, model: this.model }
    }
    const usage = {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      reasoningTokens: 0,
      costUsd: (res.usage.input_tokens * (this.#options.inputPricePerMTok ?? JEV_INPUT_PRICE_PER_MTOK)) / 1_000_000,
      retries: 0,
    }
    const answers = res.answers as Record<string, { choice?: string; confidence?: number; probabilities?: Record<string, number>; noul?: number; score?: number } | undefined>
    const win = answers.win?.noul
    if (typeof win !== 'number' || !Number.isFinite(win) || win < 0 || win > 1) {
      return { ok: false, error: 'api returned no valid win probability', kind: 'infra', usage, model: res.model }
    }
    if (decomposed) {
      const strength = answers.strength
      if (typeof strength?.score !== 'number' || !Number.isFinite(strength.score) || strength.score < 0 || strength.score > STRENGTH_LEVELS.length - 1) {
        return { ok: false, error: 'api returned no valid strength score', kind: 'infra', usage, model: res.model }
      }
      const optionId = decomposedMove(obs, win, strength.score)
      const pct = (x: number) => `${Math.round(x * 100)}%`
      const price = obs.facts.toCall > 0 ? ` against pot odds ${pct(obs.facts.potOddsPct / 100)}` : ''
      return {
        ok: true,
        decision: {
          optionId,
          winProbability: win,
          // TypeSafe's confidence in the strength score (how concentrated its level probabilities are).
          confidence: typeof strength.confidence === 'number' ? strength.confidence : null,
          optionProbabilities: null,
          reasoning: `strength ${strength.score.toFixed(1)} of ${STRENGTH_LEVELS.length - 1}, win ${pct(win)}${price}: ${optionId.replace(/_/g, ' ')}`,
        },
        usage,
        model: res.model,
      }
    }
    const action = answers.action
    const offered = new Set<string>(options.map((o) => o.id))
    // TypeSafe guarantees answers come from the offered set; if the API ever breaks that, it is an
    // infrastructure fault, not Jev's decision.
    if (!action || typeof action.choice !== 'string' || !offered.has(action.choice)) {
      return { ok: false, error: `api returned an option that was not offered: ${action?.choice}`, kind: 'infra', usage, model: res.model }
    }
    const optionProbabilities = Object.fromEntries(
      Object.entries(action.probabilities ?? {}).filter(([id]) => offered.has(id)),
    ) as Partial<Record<OptionId, number>>
    return {
      ok: true,
      decision: {
        optionId: chooseMove(optionProbabilities, action.choice) as OptionId,
        winProbability: win,
        // Jev's confidence is derived from how concentrated its option probabilities are (TypeSafe's
        // definition); the LLMs' is self-reported. Analyse them separately.
        confidence: action.confidence ?? null,
        optionProbabilities,
        reasoning: null,
        jevChoice: action.choice as OptionId,
      },
      usage,
      model: res.model,
    }
  }
}
