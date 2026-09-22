import { JEV_INPUT_PRICE_PER_MTOK } from '@ab/players'

/** One entry of OpenRouter's public model list (the fields we use). */
export interface CatalogEntry {
  id: string
  name?: string
  pricing: { prompt: string; completion: string }
  supported_parameters?: string[]
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
}

/** A model a seat can use, with its estimated cost per decision. */
export interface ModelOption {
  id: string
  name: string
  decisionUsd: number
  /** In our short list of well-known models (the ones we use ourselves first). */
  featured: boolean
}

export type SeatChoice = { kind: 'jev' } | { kind: 'llm'; model: string } | { kind: 'bot' }

/** Tokens per decision used for estimates: the prompt is about 800 tokens, a reply about 80. */
export const PROMPT_TOKENS = 800
export const REPLY_TOKENS = 80
/** A turbo game rarely needs more decisions than this from one seat (mock games: 60 to 110). */
export const DECISIONS_PER_SEAT = 120
/** Models dearer than this per decision are left out: one game could cost several dollars a seat. */
export const MAX_DECISION_USD = 0.02

/** Well-known models, listed first (our live line-up, then popular cheaper ones). */
export const FEATURED = [
  'anthropic/claude-sonnet-5',
  'openai/gpt-5.6-sol',
  'google/gemini-3.8-flash',
  'meta-llama/llama-4-maverick',
  'anthropic/claude-opus-5',
  'x-ai/grok-4.7',
  'deepseek/deepseek-v4.1-flash',
  'qwen/qwen3.8-flash',
  'mistralai/mistral-small-2603',
  'moonshotai/kimi-k2.6',
]

export const CATALOG_URL = 'https://openrouter.ai/api/v1/models'

/** OpenRouter's public model list (no key needed; the API allows browser calls). */
export async function loadCatalog(fetchImpl: typeof fetch = fetch): Promise<CatalogEntry[]> {
  const res = await fetchImpl(CATALOG_URL)
  if (!res.ok) throw new Error(`model list: HTTP ${res.status}`)
  const body = (await res.json()) as { data?: CatalogEntry[] }
  return body.data ?? []
}

/** Estimated cost of one decision by this model (USD). */
export function decisionUsd(m: CatalogEntry): number {
  return PROMPT_TOKENS * Number(m.pricing.prompt) + REPLY_TOKENS * Number(m.pricing.completion)
}

/** Estimated cost of one Jev decision (input tokens only; output is free). */
export function jevDecisionUsd(): number {
  return (PROMPT_TOKENS * JEV_INPUT_PRICE_PER_MTOK) / 1e6
}

/**
 * The models a seat can use: text in and out, strict structured outputs (our player needs a reply in
 * a fixed JSON shape), a fixed price per token no higher than MAX_DECISION_USD a decision, and not a
 * free (rate-limited), batch (asynchronous) or moving-alias ("~") variant. Featured models first, in
 * FEATURED order, then the rest by name.
 */
export function supportedModels(catalog: CatalogEntry[]): ModelOption[] {
  const options = catalog
    .filter((m) => (m.architecture?.input_modalities ?? []).includes('text') && (m.architecture?.output_modalities ?? []).includes('text'))
    .filter((m) => (m.supported_parameters ?? []).includes('structured_outputs'))
    .filter((m) => !m.id.startsWith('~') && !/:(free|batch)$/.test(m.id))
    .filter((m) => Number(m.pricing.prompt) >= 0 && Number(m.pricing.completion) >= 0 && decisionUsd(m) <= MAX_DECISION_USD)
    .map((m) => ({ id: m.id, name: m.name ?? m.id, decisionUsd: decisionUsd(m), featured: FEATURED.includes(m.id) }))
  const rank = (m: ModelOption) => (m.featured ? FEATURED.indexOf(m.id) : FEATURED.length)
  return options.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

/** Estimated cost of a whole game (USD): each paid seat at DECISIONS_PER_SEAT decisions. Unknown models count 0. */
export function estimateGameUsd(seats: SeatChoice[], models: Map<string, ModelOption>): number {
  return seats.reduce((usd, s) => {
    if (s.kind === 'jev') return usd + DECISIONS_PER_SEAT * jevDecisionUsd()
    if (s.kind === 'llm') return usd + DECISIONS_PER_SEAT * (models.get(s.model)?.decisionUsd ?? 0)
    return usd
  }, 0)
}
