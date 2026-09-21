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
  reasoning?: { effort?: 'none' | 'minimal' | 'low'; enabled?: boolean }
  provider?: { require_parameters?: boolean }
}

export interface ChatResult {
  content: string
  /** Model that actually served the request. */
  model: string
  promptTokens: number
  completionTokens: number
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
  const body = JSON.parse(text) as {
    model?: string
    choices?: Array<{ message?: { content?: string | null } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
  }
  return {
    content: body.choices?.[0]?.message?.content ?? '',
    model: body.model ?? request.model,
    promptTokens: body.usage?.prompt_tokens ?? 0,
    completionTokens: body.usage?.completion_tokens ?? 0,
    cost: body.usage?.cost ?? 0,
  }
}
