import { card } from '../lib/format'

/** A playing card, or its back when `code` is null. */
export function PlayingCard({ code, small = false }: { code: string | null; small?: boolean }) {
  if (!code) return <span className={`card back${small ? ' small' : ''}`} aria-label="face-down card" />
  const c = card(code)
  return (
    <span className={`card${c.red ? ' red' : ''}${small ? ' small' : ''}`} aria-label={`${c.rank} of ${c.suit}`}>
      <b>{c.rank}</b>
      <i>{c.suit}</i>
    </span>
  )
}
