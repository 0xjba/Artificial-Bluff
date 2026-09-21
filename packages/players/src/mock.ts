import { tagChoice } from './bots'
import type { DecideResult, Observation, Player } from './types'

export interface MockLlmOptions {
  /** Pretend price per 1M input tokens, for cost-tracking tests. */
  inputPricePerMTok?: number
  /** Resolve after this many ms (respecting abort). */
  latencyMs?: number
  /** Return an ordinary failure on every Nth decision (1-based). */
  failEvery?: number
  /** Return an option id that isn't offered on every Nth decision (1-based). */
  invalidEvery?: number
}

/**
 * Free, deterministic stand-in for an LLM: TAG rules, fake reasoning, fake token usage.
 * Its win probabilities and confidence are crude rule-bucket constants, not estimates:
 * never use mock games for calibration analysis.
 */
export class MockLlm implements Player {
  readonly kind = 'mock' as const
  private calls = 0
  constructor(
    readonly id: string,
    readonly model = 'mock/llm',
    private readonly options: MockLlmOptions = {},
  ) {}

  async decide(obs: Observation, signal: AbortSignal): Promise<DecideResult> {
    if (signal.aborted) throw new Error('aborted')
    this.calls++
    const inputTokens = Math.ceil(JSON.stringify(obs).length / 4)
    const usage = {
      inputTokens,
      outputTokens: 40,
      costUsd: (inputTokens * (this.options.inputPricePerMTok ?? 1)) / 1_000_000,
      retries: 0,
    }
    if (this.options.latencyMs) await delay(this.options.latencyMs, signal)
    if (this.options.failEvery && this.calls % this.options.failEvery === 0) {
      return { ok: false, error: 'mock failure', usage, model: this.model }
    }
    const { optionId, winProbability } = tagChoice(obs)
    const invalid = this.options.invalidEvery && this.calls % this.options.invalidEvery === 0
    return {
      ok: true,
      decision: {
        optionId: invalid ? ('not_an_option' as never) : optionId,
        winProbability,
        confidence: 0.6,
        optionProbabilities: null,
        reasoning: `mock: ${optionId} on the ${obs.street}`,
      },
      usage,
      model: this.model,
    }
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'))
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    })
  })
}
