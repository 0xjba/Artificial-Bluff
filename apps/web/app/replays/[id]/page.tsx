import type { GameEvent } from '@ab/core/view'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { ReplayScreen } from '../../../components/ReplayScreen'
import { API_URL } from '../../../lib/api'

/** Every event of a finished game (the API pages them 5,000 at a time). */
async function loadEvents(id: string): Promise<GameEvent[] | null> {
  const events: GameEvent[] = []
  let after = 0
  for (;;) {
    const res = await fetch(`${API_URL}/api/games/${encodeURIComponent(id)}/events?after=${after}`, { cache: 'no-store' })
    if (res.status === 404 || res.status === 409) return null
    if (!res.ok) throw new Error(`events: HTTP ${res.status}`)
    const page = (await res.json()) as { events: GameEvent[]; next: number | null }
    events.push(...page.events)
    if (page.next === null) return events
    after = page.next
  }
}

export default async function Replay({ params }: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await params
  const events = await loadEvents(id)
  if (!events) notFound()
  return <ReplayScreen title={`REPLAY · ${id}`} events={events} />
}
