import Link from 'next/link'
import { connection } from 'next/server'
import { API_URL } from '../../lib/api'

interface GameSummary {
  id: string
  kind: 'live' | 'study'
  status: 'running' | 'ended' | 'interrupted'
  createdAt: number
}

export const metadata = { title: 'Replays · artificialBluff' }

/** Past live games, newest first (studies are on the research page). */
export default async function Replays() {
  await connection()
  let games: GameSummary[] = []
  let error: string | null = null
  try {
    const res = await fetch(`${API_URL}/api/games`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    games = ((await res.json()) as { games: GameSummary[] }).games.filter((g) => g.kind === 'live' && g.status !== 'running')
  } catch {
    error = 'The live server is not reachable right now.'
  }
  return (
    <section className="page">
      <h1>Replays</h1>
      <p className="muted">Every finished live game, move by move, with each model’s stated chances and reasoning.</p>
      {error ? <p className="warn">{error}</p> : null}
      {!error && games.length === 0 ? <p className="muted">No finished games yet.</p> : null}
      <ul className="games">
        {games.map((g) => (
          <li key={g.id}>
            <Link href={`/replays/${encodeURIComponent(g.id)}`}>{new Date(g.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</Link>
            <span className="muted"> · {g.status === 'ended' ? 'played to the end' : 'stopped early'}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
