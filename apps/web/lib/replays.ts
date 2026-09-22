import type { HandSummary, HandTag } from '@ab/server'
import { API_URL } from './api'

export interface GameSummary {
  id: string
  kind: 'live' | 'study'
  status: 'running' | 'ended' | 'interrupted'
  createdAt: number
  endedAt: number | null
}

/** The filters on the replays page, and what they keep. */
export const FILTERS: Array<{ id: 'all' | HandTag; label: string }> = [
  { id: 'all', label: 'All hands' },
  { id: 'biggest-pot', label: 'Biggest pot' },
  { id: 'elimination', label: 'Knock-outs' },
  { id: 'showdown', label: 'Showdowns' },
  { id: 'jev-vs-llm', label: 'Jev vs LLM' },
  { id: 'worst-read', label: 'Worst reads' },
  { id: 'split', label: 'Split pots' },
  { id: 'timeout', label: 'Timeouts' },
]

export const filterHands = (hands: HandSummary[], tag: string) => (tag === 'all' ? hands : hands.filter((h) => (h.tags as string[]).includes(tag)))

/** Live games the site can replay, newest first (studies live on the research page). */
export async function loadGames(): Promise<GameSummary[] | null> {
  try {
    const res = await fetch(`${API_URL}/api/games`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const body = (await res.json()) as { games: GameSummary[] }
    return body.games.filter((g) => g.kind === 'live')
  } catch {
    return null
  }
}

/** Every hand of a game, newest first. */
export async function loadHands(gameId: string): Promise<HandSummary[] | null> {
  try {
    const res = await fetch(`${API_URL}/api/hands/${encodeURIComponent(gameId)}`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })
    if (!res.ok) return null
    const body = (await res.json()) as { hands: HandSummary[] }
    return body.hands
  } catch {
    return null
  }
}
