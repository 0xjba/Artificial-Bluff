import { choice, noul, TypeSafeClient, type TypeSafeClientConfig } from '@typesafe-ai/sdk'
import type { OptionId } from '@ab/engine'
import { OPTION_SEMANTICS, WIN_CONDITION } from '../llm/prompt'
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
  // ES-private so the API key can't leak through JSON.stringify or console.log of a player.
  readonly #options: JevPlayerOptions
  readonly #client: TypeSafeClient

  constructor(options: JevPlayerOptions) {
    this.#options = options
    this.id = options.id
    this.model = options.model
    this.#client = new TypeSafeClient({ defaultModel: options.model, ...options.client })
  }

  async decide(obs: Observation, signal: AbortSignal): Promise<DecideResult> {
    const { options, ...state } = obs
    const offered = new Set<string>(options.map((o) => o.id))
    const criteria = Object.fromEntries(options.map((o) => [o.id, o.label]))
    let res
    try {
      res = await this.#client.systemOne(
        {
          model: this.model,
          state: JSON.parse(JSON.stringify(state)),
          questions: {
            action: choice(ACTION_INSTRUCTIONS, criteria),
            win: noul(WIN_INSTRUCTIONS),
          },
        },
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
    const action = res.answers.action
    const win = res.answers.win?.noul
    // TypeSafe guarantees answers come from the offered set; if the API ever breaks that, it is an
    // infrastructure fault, not Jev's decision.
    if (!action || !offered.has(action.choice)) {
      return { ok: false, error: `api returned an option that was not offered: ${action?.choice}`, kind: 'infra', usage, model: res.model }
    }
    if (typeof win !== 'number' || !Number.isFinite(win) || win < 0 || win > 1) {
      return { ok: false, error: 'api returned no valid win probability', kind: 'infra', usage, model: res.model }
    }
    const optionProbabilities = Object.fromEntries(
      Object.entries(action.probabilities).filter(([id]) => offered.has(id)),
    ) as Partial<Record<OptionId, number>>
    return {
      ok: true,
      decision: {
        optionId: chooseMove(optionProbabilities, action.choice) as OptionId,
        winProbability: win,
        // Jev's confidence is derived from how concentrated its option probabilities are (TypeSafe's
        // definition); the LLMs' is self-reported. Analyse them separately.
        confidence: action.confidence,
        optionProbabilities,
        reasoning: null,
        jevChoice: action.choice as OptionId,
      },
      usage,
      model: res.model,
    }
  }
}
