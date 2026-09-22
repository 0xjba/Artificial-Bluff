import type { GameEvent } from '@ab/core/view'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { ReplayScreen } from '../../../components/ReplayScreen'
import { API_URL } from '../../../lib/api'
import { loadHands } from '../../../lib/replays'

/** Every event of a finished game (the API pages them 5,000 at a time). */
async function loadEvents(id: string): Promise<GameEvent[] | null> {
  const events: GameEvent[] = []
  let after = 0
  for (;;) {
    const res = await fetch(`${API_URL}/api/games/${encodeURIComponent(id)}/events?after=${after}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    if (res.status === 404 || res.status === 409) return null
    if (!res.ok) throw new Error(`events: HTTP ${res.status}`)
    const page = (await res.json()) as { events: GameEvent[]; next: number | null }
    events.push(...page.events)
    if (page.next === null) return events
    after = page.next
  }
}

/** Game ids are made of these characters (live-<timestamp>, study ids). */
const GAME_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

export default async function Replay({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ hand?: string }> }) {
  await connection()
  const { id } = await params
  const { hand } = await searchParams
  if (!GAME_ID.test(id)) notFound()
  const events = await loadEvents(id)
  if (!events) notFound()
  // ?hand=N opens the replay on that hand, using the same numbering the hand index publishes.
  const wanted = Number(hand)
  const index = Number.isInteger(wanted) && wanted >= 1 ? await loadHands(id) : null
  const from = index?.find((h) => h.number === wanted)?.startSeq
  return <ReplayScreen title={`REPLAY · ${id}`} events={events} {...(from === undefined ? {} : { fromSeq: from })} />
}
