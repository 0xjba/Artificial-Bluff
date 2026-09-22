import type { ScoredDecision } from '@ab/analysis'

const COLUMNS = [
  'handId', 'index', 'playerId', 'street', 'position', 'model', 'optionId', 'actionType', 'chipsIn', 'pot', 'winnablePot', 'toCall',
  'stackBefore', 'board', 'live', 'winProbability', 'confidence', 'optionProbabilities', 'latencyMs', 'inputTokens',
  'outputTokens', 'reasoningTokens', 'costUsd', 'retries', 'fallback', 'fallbackKind', 'mainPotShare', 'expectedShare',
  'actionGood', 'stackChange',
] as const satisfies ReadonlyArray<keyof ScoredDecision>

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = Array.isArray(value) ? value.join(' ') : typeof value === 'object' ? JSON.stringify(value) : String(value)
  // Text a spreadsheet would run as a formula gets a leading apostrophe (numbers are left alone).
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * One row per decision (RFC 4180 quoting); arrays are space-separated, objects are JSON, and text
 * starting with = + - @ is prefixed with ' so spreadsheets don't evaluate it.
 */
export function decisionsCsv(decisions: readonly ScoredDecision[]): string {
  const lines = [COLUMNS.join(',')]
  for (const d of decisions) lines.push(COLUMNS.map((c) => cell(d[c])).join(','))
  return `${lines.join('\n')}\n`
}
