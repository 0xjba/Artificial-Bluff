import type { DecideResult, Observation, Player, Usage } from '../types'
import { parseDecision } from './parse'
import { responseFormat, systemPrompt, userMessage } from './prompt'
import { chatCompletion, type ChatMessage, type ChatRequest, type OpenRouterConfig } from './openrouter'

/**
 * How to handle a model's reasoning ("thinking"):
 * - 'off': send reasoning {effort: 'none'} (default; reasoning-capable models that allow turning it off)
 * - 'minimal': models that always reason ("Reasoning is mandatory for this endpoint"): the least they
 *   allow, {effort: 'minimal', exclude: true}, with room for the hidden tokens
 * - 'low': {effort: 'low', exclude: true} and the same allowance, for models without 'minimal'
 * - 'omit': models without a reasoning parameter: send nothing
 */
/** Characters kept of each unusable reply. */
const RAW_REPLY_CHARS = 1000

export type ReasoningMode = 'off' | 'minimal' | 'low' | 'omit'

/** Reasoning modes that spend hidden tokens before the answer, and so need a larger allowance. */
const REASONS: ReadonlySet<ReasoningMode> = new Set(['minimal', 'low'])

export interface LlmPlayerOptions {
  id: string
  /** OpenRouter model id, e.g. "anthropic/claude-sonnet-5". */
  model: string
  openrouter: OpenRouterConfig
  temperature?: number
  /** Send `temperature` (some reasoning models reject it). Default true. */
  sendTemperature?: boolean
  /** Default 150 with reasoning 'off'/'omit', 1500 with 'minimal' or 'low'. */
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
  /** ES-private so the API key can't leak through JSON.stringify or console.log of a player. */
  readonly #options: LlmPlayerOptions

  constructor(options: LlmPlayerOptions) {
    this.#options = options
    this.id = options.id
    this.model = options.model
  }

  private request(messages: ChatMessage[], obs: Observation): ChatRequest {
    const o = this.#options
    const reasoning = o.reasoning ?? 'off'
    return {
      model: o.model,
      messages,
      max_tokens: o.maxTokens ?? (REASONS.has(reasoning) ? 1500 : 150),
      ...((o.sendTemperature ?? true) ? { temperature: o.temperature ?? 0.3 } : {}),
      ...((o.structuredOutput ?? true) ? { response_format: responseFormat(obs), provider: { require_parameters: true } } : {}),
      ...(reasoning === 'off' ? { reasoning: { effort: 'none' as const } } : {}),
      ...(reasoning === 'minimal' ? { reasoning: { effort: 'minimal' as const, exclude: true } } : {}),
      ...(reasoning === 'low' ? { reasoning: { effort: 'low' as const, exclude: true } } : {}),
    }
  }

  async decide(obs: Observation, signal: AbortSignal): Promise<DecideResult> {
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt(obs.facts.hand !== undefined) },
      { role: 'user', content: userMessage(obs) },
    ]
    const usage: Usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, retries: 0 }
    let servedBy = this.model
    let provider: string | null = null
    // What the model wrote on each attempt, bounded, so an unusable answer can be read later.
    const replies: string[] = []
    const rawReply = () => replies.map((r) => (r.length > RAW_REPLY_CHARS ? `${r.slice(0, RAW_REPLY_CHARS)}…` : r)).join('\n---\n')
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) usage.retries++
      let res
      try {
        res = await chatCompletion(this.#options.openrouter, this.request(messages, obs), signal)
      } catch (e) {
        return { ok: false, error: (e as Error).message, kind: 'infra', usage, model: servedBy, provider }
      }
      usage.inputTokens += res.promptTokens
      usage.outputTokens += res.completionTokens
      usage.reasoningTokens += res.reasoningTokens
      usage.costUsd += res.cost
      servedBy = res.model
      provider = res.provider ?? provider
      replies.push(res.content)
      if (res.error) {
        // A provider failure reported inside a 200: not the model's fault, and retrying won't help.
        return { ok: false, error: `provider error: ${res.error}`, kind: 'infra', usage, model: servedBy, provider }
      }
      if (res.finishReason === 'length') {
        return { ok: false, error: 'truncated: reply hit max_tokens', kind: 'model', usage, model: servedBy, provider, rawReply: rawReply() }
      }
      const problem = res.refused
        ? 'the reply was a refusal'
        : res.content.trim() === ''
          ? 'the reply was empty'
          : null
      const parsed = problem === null ? parseDecision(res.content, obs) : ({ ok: false, error: problem } as const)
      if (parsed.ok) return { ok: true, decision: parsed.decision, usage, model: servedBy, provider }
      if (attempt === 1) return { ok: false, error: `invalid output: ${parsed.error}`, kind: 'model', usage, model: servedBy, provider, rawReply: rawReply() }
      // Don't echo an empty assistant turn back: some providers reject it.
      if (res.content.trim() !== '') messages.push({ role: 'assistant', content: res.content })
      messages.push({ role: 'user', content: `That reply was invalid: ${parsed.error}. Reply again with only the JSON object.` })
    }
    throw new Error('unreachable')
  }
}
