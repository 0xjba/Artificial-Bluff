import type { OptionId } from '@ab/engine'
import type { Decision, Observation } from '../types'

export const MAX_REASONING = 120

export type ParseResult = { ok: true; decision: Decision } | { ok: false; error: string }

function probability(value: unknown, name: string): number | string {
  // No rescaling of values above 1 (e.g. 55 meaning 55%): a guess would corrupt calibration data.
  // Out-of-range values are rejected and the model is asked again.
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    return `"${name}" must be a number from 0 to 1`
  }
  return value
}

/**
 * Parses and validates an LLM reply against the offered options. Tolerates code fences and
 * text around the JSON object (the first "{" to the last "}"), and case/whitespace in the action.
 */
export function parseDecision(content: string, obs: Observation): ParseResult {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start < 0 || end < start) return { ok: false, error: 'reply did not contain a JSON object' }
  let raw: unknown
  try {
    raw = JSON.parse(content.slice(start, end + 1))
  } catch {
    return { ok: false, error: 'reply was not valid JSON' }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'reply must be a JSON object' }
  }
  const r = raw as Record<string, unknown>
  const ids = obs.options.map((o) => o.id)
  const action = typeof r.action === 'string' ? r.action.trim().toLowerCase() : null
  if (action === null || !ids.includes(action as OptionId)) {
    return { ok: false, error: `"action" must be one of: ${ids.join(', ')}` }
  }
  const win = probability(r.win_probability, 'win_probability')
  if (typeof win === 'string') return { ok: false, error: win }
  const confidence = probability(r.confidence, 'confidence')
  if (typeof confidence === 'string') return { ok: false, error: confidence }
  const reasoning = typeof r.reasoning === 'string' ? r.reasoning.trim().slice(0, MAX_REASONING) : null
  return {
    ok: true,
    decision: { optionId: action as OptionId, winProbability: win, confidence, optionProbabilities: null, reasoning },
  }
}
