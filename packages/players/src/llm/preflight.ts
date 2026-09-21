import type { PlayerSpec } from '../factory'
import type { Fetch } from './openrouter'

export interface CatalogModel {
  id: string
  supported_parameters?: string[]
}

/** OpenRouter's public model list (no key needed). */
export async function fetchModelCatalog(fetchImpl: Fetch = fetch, baseUrl = 'https://openrouter.ai/api/v1'): Promise<Map<string, CatalogModel>> {
  const res = await fetchImpl(`${baseUrl}/models`)
  if (!res.ok) throw new Error(`model catalog: HTTP ${res.status}`)
  const body = (await res.json()) as { data?: CatalogModel[] }
  return new Map((body.data ?? []).map((m) => [m.id, m]))
}

/**
 * Checks each LLM seat against the catalog and fills in unset request flags from what the model
 * supports, so a seat can't fail every call because a parameter is unsupported (with
 * provider.require_parameters, one unsupported parameter means no endpoint at all).
 * Explicit settings in the spec are kept. Rules:
 * - structuredOutput: only 'structured_outputs' promises strict json_schema; 'response_format' alone may
 *   mean JSON mode only, so those models get plain JSON replies (the parser validates either way).
 * - reasoning: 'off' if the model has a 'reasoning' parameter, else 'omit'. The catalog can't tell whether
 *   a model can turn reasoning off; set 'low' by hand for models a smoke test shows reject effort 'none'.
 * - sendTemperature: whether 'temperature' is supported.
 */
export function adaptLineup(specs: PlayerSpec[], catalog: Map<string, CatalogModel>): { specs: PlayerSpec[]; problems: string[] } {
  const problems: string[] = []
  const adapted = specs.map((spec): PlayerSpec => {
    if (spec.kind !== 'llm') return spec
    const model = catalog.get(spec.model)
    if (!model) {
      problems.push(`${spec.id}: model "${spec.model}" is not in the OpenRouter catalog`)
      return spec
    }
    const params = new Set(model.supported_parameters ?? [])
    const strict = params.has('structured_outputs')
    if (spec.structuredOutput === undefined && !strict) {
      problems.push(`${spec.id}: "${spec.model}" has no strict structured output; using plain JSON replies`)
    }
    return {
      ...spec,
      structuredOutput: spec.structuredOutput ?? strict,
      reasoning: spec.reasoning ?? (params.has('reasoning') ? 'off' : 'omit'),
      sendTemperature: spec.sendTemperature ?? params.has('temperature'),
    }
  })
  return { specs: adapted, problems }
}
