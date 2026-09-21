import type { DecideResult, Observation, Player, Usage } from '../types'
import { parseDecision } from './parse'
import { SYSTEM_PROMPT, responseFormat, userMessage } from './prompt'
import { chatCompletion, type ChatMessage, type ChatRequest, type OpenRouterConfig } from './openrouter'

/**
 * How to handle a model's reasoning ("thinking"):
 * - 'off': send reasoning {effort: 'none'} (default; reasoning-capable models that allow turning it off)
 * - 'low': models that always reason: {effort: 'low', exclude: true} and a larger token allowance
 * - 'omit': models without a reasoning parameter: send nothing
 */
export type ReasoningMode = 'off' | 'low' | 'omit'

export interface LlmPlayerOptions {
  id: string
  /** OpenRouter model id, e.g. "anthropic/claude-sonnet-5". */
  model: string
  openrouter: OpenRouterConfig
  temperature?: number
  /** Send `temperature` (some reasoning models reject it). Default true. */
  sendTemperature?: boolean
  /** Default 150 with reasoning 'off'/'omit', 1500 with 'low'. */
  maxTokens?: number
  reasoning?: ReasoningMode
  /** Use JSON-schema structured output and route only to endpoints that support it. Default true. */
  structuredOutput?: boolean
}

/**
 * An LLM seat via OpenRouter. An invalid or empty reply gets one retry quoting the problem
 * (Jev cannot produce invalid output, so this is the LLMs' equivalent; its cost and latency count).
 * A reply cut off by max_tokens fails without a retry, since the same limit would cut it again.
 */
export class LlmPlayer implements Player {
  readonly kind = 'llm' as const
  readonly id: string
  readonly model: string

  constructor(private readonly options: LlmPlayerOptions) {
    this.id = options.id
    this.model = options.model
  }

  private request(messages: ChatMessage[], obs: Observation): ChatRequest {
    const o = this.options
    const reasoning = o.reasoning ?? 'off'
    return {
      model: o.model,
      messages,
      max_tokens: o.maxTokens ?? (reasoning === 'low' ? 1500 : 150),
      ...((o.sendTemperature ?? true) ? { temperature: o.temperature ?? 0.3 } : {}),
      ...((o.structuredOutput ?? true) ? { response_format: responseFormat(obs), provider: { require_parameters: true } } : {}),
      ...(reasoning === 'off' ? { reasoning: { effort: 'none' as const } } : {}),
      ...(reasoning === 'low' ? { reasoning: { effort: 'low' as const, exclude: true } } : {}),
    }
  }

  async decide(obs: Observation, signal: AbortSignal): Promise<DecideResult> {
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage(obs) },
    ]
    const usage: Usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, retries: 0 }
    let servedBy = this.model
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) usage.retries++
      let res
      try {
        res = await chatCompletion(this.options.openrouter, this.request(messages, obs), signal)
      } catch (e) {
        return { ok: false, error: (e as Error).message, kind: 'infra', usage, model: servedBy }
      }
      usage.inputTokens += res.promptTokens
      usage.outputTokens += res.completionTokens
      usage.reasoningTokens += res.reasoningTokens
      usage.costUsd += res.cost
      servedBy = res.model
      if (res.finishReason === 'length') {
        return { ok: false, error: 'truncated: reply hit max_tokens', kind: 'model', usage, model: servedBy }
      }
      const problem = res.refused
        ? 'the reply was a refusal'
        : res.content.trim() === ''
          ? 'the reply was empty'
          : null
      const parsed = problem === null ? parseDecision(res.content, obs) : ({ ok: false, error: problem } as const)
      if (parsed.ok) return { ok: true, decision: parsed.decision, usage, model: servedBy }
      if (attempt === 1) return { ok: false, error: `invalid output: ${parsed.error}`, kind: 'model', usage, model: servedBy }
      // Don't echo an empty assistant turn back: some providers reject it.
      if (res.content.trim() !== '') messages.push({ role: 'assistant', content: res.content })
      messages.push({ role: 'user', content: `That reply was invalid: ${parsed.error}. Reply again with only the JSON object.` })
    }
    throw new Error('unreachable')
  }
}
