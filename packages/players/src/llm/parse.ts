import type { OptionId } from '@ab/engine'
import type { Decision, Observation } from '../types'

export const MAX_REASONING = 120

export type ParseResult = { ok: true; decision: Decision } | { ok: false; error: string }

function probability(value: unknown, name: string): number | string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `"${name}" must be a number between 0 and 1`
  // Accept percentages (e.g. 70) by scaling, a common model slip.
  const p = value > 1 && value <= 100 ? value / 100 : value
  if (p < 0 || p > 1) return `"${name}" must be between 0 and 1`
  return p
}

/** Parses and validates an LLM reply against the offered options. */
export function parseDecision(content: string, obs: Observation): ParseResult {
  const text = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim()
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'reply was not valid JSON' }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'reply must be a JSON object' }
  }
  const r = raw as Record<string, unknown>
  const ids = obs.options.map((o) => o.id)
  if (typeof r.action !== 'string' || !ids.includes(r.action as OptionId)) {
    return { ok: false, error: `"action" must be one of: ${ids.join(', ')}` }
  }
  const win = probability(r.win_probability, 'win_probability')
  if (typeof win === 'string') return { ok: false, error: win }
  const confidence = probability(r.confidence, 'confidence')
  if (typeof confidence === 'string') return { ok: false, error: confidence }
  const reasoning = typeof r.reasoning === 'string' ? r.reasoning.trim().slice(0, MAX_REASONING) : null
  return {
    ok: true,
    decision: {
      optionId: r.action as OptionId,
      winProbability: win,
      confidence,
      optionProbabilities: null,
      reasoning,
    },
  }
}
