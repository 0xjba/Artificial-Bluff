export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
  response_format?: unknown
  reasoning?: { effort?: 'none' | 'minimal' | 'low'; exclude?: boolean }
  provider?: { require_parameters?: boolean }
}

export interface ChatResult {
  content: string
  /** "stop", "length" (hit max_tokens), "tool_calls", ... or null if absent. */
  finishReason: string | null
  /** True when the model refused (non-empty `refusal` field). */
  refused: boolean
  /** Provider error reported inside a 200 response (no choices), or null. */
  error: string | null
  /** Model that actually served the request. */
  model: string
  /** The host OpenRouter routed the call to, when it says. */
  provider: string | null
  promptTokens: number
  /** Billed completion tokens, including reasoning tokens. */
  completionTokens: number
  reasoningTokens: number
  /** Cost in OpenRouter credits (USD), as reported in `usage.cost`; 0 if absent. */
  cost: number
}

export class OpenRouterError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`OpenRouter ${status}: ${body.slice(0, 300)}`)
  }
}

export interface OpenRouterConfig {
  apiKey: string
  baseUrl?: string
  fetch?: Fetch
  /** Sent as HTTP-Referer / X-Title so the app shows up in OpenRouter's dashboard. */
  referer?: string
  title?: string
}

/** One non-streaming chat completion. Throws OpenRouterError on non-2xx. */
export async function chatCompletion(
  config: OpenRouterConfig,
  request: ChatRequest,
  signal?: AbortSignal,
): Promise<ChatResult> {
  const doFetch = config.fetch ?? fetch
  const res = await doFetch(`${config.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': config.referer ?? 'https://github.com/0xjba/artificialBluff',
      'X-Title': config.title ?? 'artificialBluff',
    },
    body: JSON.stringify(request),
    signal,
  })
  const text = await res.text()
  if (!res.ok) throw new OpenRouterError(res.status, text)
  // A 200 whose body isn't JSON (e.g. a gateway page) may still have been billed; cost is unknown then.
  const body = JSON.parse(text) as {
    error?: { message?: string } | string
    model?: string
    provider?: string
    choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null; refusal?: string | null } }>
    usage?: {
      prompt_tokens?: number
      completion_tokens?: number
      cost?: number
      completion_tokens_details?: { reasoning_tokens?: number }
    }
  }
  const choice = body.choices?.[0]
  return {
    content: choice?.message?.content ?? '',
    finishReason: choice?.finish_reason ?? null,
    refused: Boolean(choice?.message?.refusal),
    error: body.error ? (typeof body.error === 'string' ? body.error : (body.error.message ?? 'provider error')) : null,
    model: body.model ?? request.model,
    provider: typeof body.provider === 'string' ? body.provider : null,
    promptTokens: body.usage?.prompt_tokens ?? 0,
    completionTokens: body.usage?.completion_tokens ?? 0,
    reasoningTokens: body.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    cost: body.usage?.cost ?? 0,
  }
}
