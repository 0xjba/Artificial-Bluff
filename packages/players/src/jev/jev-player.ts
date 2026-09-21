import { choice, noul, TypeSafeClient, type TypeSafeClientConfig } from '@typesafe-ai/sdk'
import type { OptionId } from '@ab/engine'
import { OPTION_SEMANTICS, WIN_CONDITION } from '../llm/prompt'
import type { DecideResult, Observation, Player } from '../types'

/**
 * Question wording. Jev answers the question as literally written, so keep these exact and
 * change them only with a new pre-registration. The win definition and option semantics are the
 * same text the LLMs get, so both kinds of player answer the same questions.
 */
export const ACTION_INSTRUCTIONS =
  `You are the player marked "you": true in this No-Limit Texas Hold'em hand ("stack" is chips behind, ` +
  `"bet" is chips bet this street, "facts" are precomputed). ${OPTION_SEMANTICS} ` +
  'Which action maximises your expected chips?'
export const WIN_INSTRUCTIONS = `The player marked "you": true will ${WIN_CONDITION}.`

export const JEV_INPUT_PRICE_PER_MTOK = 0.042

export interface JevPlayerOptions {
  id: string
  /** Pinned model version, e.g. "jev-1.13.0". */
  model: string
  /** Passed to TypeSafeClient (apiKey, fetch for tests, etc.). */
  client?: TypeSafeClientConfig
  /** USD per 1M input tokens; output is free. */
  inputPricePerMTok?: number
  /** Retries inside the SDK after the first attempt (HTTP 408/429/5xx and connection errors). */
  maxRetries?: number
}

/** The Jev seat: one systemOne call per decision, a Choice over options plus a win Noul. */
export class JevPlayer implements Player {
  readonly kind = 'jev' as const
  readonly id: string
  readonly model: string
  private readonly client: TypeSafeClient

  constructor(private readonly options: JevPlayerOptions) {
    this.id = options.id
    this.model = options.model
    this.client = new TypeSafeClient({ defaultModel: options.model, ...options.client })
  }

  async decide(obs: Observation, signal: AbortSignal): Promise<DecideResult> {
    const { options, ...state } = obs
    const criteria = Object.fromEntries(options.map((o) => [o.id, o.label]))
    try {
      const res = await this.client.systemOne(
        {
          model: this.model,
          state: JSON.parse(JSON.stringify(state)),
          questions: {
            action: choice(ACTION_INSTRUCTIONS, criteria),
            win: noul(WIN_INSTRUCTIONS),
          },
        },
        { signal, retry: { maxRetries: this.options.maxRetries ?? 1 } },
      )
      const usage = {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        reasoningTokens: 0,
        costUsd: (res.usage.input_tokens * (this.options.inputPricePerMTok ?? JEV_INPUT_PRICE_PER_MTOK)) / 1_000_000,
        retries: 0,
      }
      const action = res.answers.action
      return {
        ok: true,
        decision: {
          optionId: action.choice as OptionId,
          winProbability: res.answers.win.noul,
          confidence: action.confidence,
          optionProbabilities: { ...action.probabilities } as Partial<Record<OptionId, number>>,
          reasoning: null,
        },
        usage,
        model: res.model,
      }
    } catch (e) {
      return {
        ok: false,
        error: (e as Error).message,
        kind: 'infra',
        usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, retries: 0 },
        model: this.model,
      }
    }
  }
}
