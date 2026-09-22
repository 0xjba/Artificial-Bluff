/** Chips with thousands separators: 12,500. */
export const chips = (n: number) => Math.round(n).toLocaleString('en-US')

/** Dollars with at least three significant digits (a Jev decision costs millionths of a dollar). */
export function usd(x: number): string {
  if (x === 0) return '$0'
  const digits = Math.min(8, Math.max(2, Math.ceil(-Math.log10(Math.abs(x))) + 2))
  return `$${x.toFixed(digits)}`
}

/** Latency: 850 ms, 1.24 s. */
export const ms = (x: number | null) => (x === null ? '–' : x >= 1000 ? `${(x / 1000).toFixed(2)} s` : x < 1 ? '<1 ms' : `${Math.round(x)} ms`)

/** A probability as a whole percentage: 0.4567 → 46%. */
export const pct = (p: number | null | undefined) => (p === null || p === undefined ? '–' : `${Math.round(p * 100)}%`)

const SUITS: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' }
/** A card for display: "Th" → { rank: "10", suit: "♥", red: true }. */
export function card(c: string): { rank: string; suit: string; red: boolean } {
  const rank = c[0] === 'T' ? '10' : c[0]!
  const s = c[1]!
  return { rank, suit: SUITS[s] ?? s, red: s === 'h' || s === 'd' }
}

/** A model id without its vendor prefix: "anthropic/claude-sonnet-5" → "claude-sonnet-5". */
export const shortModel = (model: string) => model.split('/').at(-1) ?? model

/** What a fallback means, in plain words (spec §9: an auto-played seat reads as a lost connection). */
export function fallbackNotice(kind: string | null, reason: string | null): string {
  if (kind === 'auto') return reason?.includes('budget') ? 'budget cap reached' : 'connection lost: seat auto-played'
  if (kind === 'timeout') return 'timed out'
  if (kind === 'infra') return 'provider error'
  if (kind === 'model') return 'invalid answer'
  return 'fallback'
}
