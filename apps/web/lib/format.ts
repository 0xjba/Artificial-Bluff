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

const POSITION_NAMES: Record<string, string> = {
  BTN: 'Dealer',
  SB: 'Small blind',
  BB: 'Big blind',
  UTG: 'First to act',
  'UTG+1': 'Early',
  'UTG+2': 'Early',
  MP: 'Middle',
  LJ: 'Middle',
  HJ: 'Middle',
  CO: 'Before dealer',
}

/** A table position in plain words: "BB" → "Big blind", "CO" → "Before dealer". */
export const positionName = (p: string | null) => (p ? (POSITION_NAMES[p] ?? p) : '')

/** A net result with its sign: +6,200, −3,100, 0. */
export const signedChips = (n: number) => (n > 0 ? `+${chips(n)}` : n < 0 ? `−${chips(-n)}` : '0')

/** A menu label, shortened for a seat card: "Raise to 2,400" → "Raise 2,400", "Call all-in 450" → "All-in 450". */
export const shortAction = (label: string) =>
  label.replace(/^Raise to /, 'Raise ').replace(/^Call all-in /, 'All-in ')

/** Time of day for the hand log: 21:04. */
export const clock = (ts: number) => {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
