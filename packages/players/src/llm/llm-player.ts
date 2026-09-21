import type { DecideResult, Observation, Player, Usage } from '../types'
import { parseDecision } from './parse'
import { SYSTEM_PROMPT, responseFormat, userMessage } from './prompt'
import { chatCompletion, type ChatMessage, type OpenRouterConfig } from './openrouter'

export interface LlmPlayerOptions {
  id: string
  /** OpenRouter model id, e.g. "anthropic/claude-sonnet-5". */
  model: string
  openrouter: OpenRouterConfig
  temperature?: number
  maxTokens?: number
  /** Send reasoning: {effort: 'none'}. Disable for models that always reason (they reject it). */
  disableReasoning?: boolean
  /** Use JSON-schema structured output and route only to endpoints that support it. */
  structuredOutput?: boolean
}

/** An LLM seat via OpenRouter. One retry with the specific error on invalid output. */
export class LlmPlayer implements Player {
  readonly kind = 'llm' as const
  readonly id: string
  readonly model: string

  constructor(private readonly options: LlmPlayerOptions) {
    this.id = options.id
    this.model = options.model
  }

  async decide(obs: Observation, signal: AbortSignal): Promise<DecideResult> {
    const o = this.options
    const structured = o.structuredOutput ?? true
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage(obs) },
    ]
    const usage: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, retries: 0 }
    let servedBy = o.model
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) usage.retries++
      let content: string
      try {
        const res = await chatCompletion(
          o.openrouter,
          {
            model: o.model,
            messages,
            temperature: o.temperature ?? 0.3,
            max_tokens: o.maxTokens ?? 150,
            ...(structured ? { response_format: responseFormat(obs), provider: { require_parameters: true } } : {}),
            ...((o.disableReasoning ?? true) ? { reasoning: { effort: 'none' as const } } : {}),
          },
          signal,
        )
        usage.inputTokens += res.promptTokens
        usage.outputTokens += res.completionTokens
        usage.costUsd += res.cost
        servedBy = res.model
        content = res.content
      } catch (e) {
        return { ok: false, error: (e as Error).message, usage, model: servedBy }
      }
      const parsed = parseDecision(content, obs)
      if (parsed.ok) return { ok: true, decision: parsed.decision, usage, model: servedBy }
      if (attempt === 1) return { ok: false, error: `invalid output: ${parsed.error}`, usage, model: servedBy }
      messages.push(
        { role: 'assistant', content },
        { role: 'user', content: `That reply was invalid: ${parsed.error}. Reply again with only the JSON object.` },
      )
    }
    throw new Error('unreachable')
  }
}
