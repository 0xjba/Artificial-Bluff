import type { HandSummary } from '@ab/server'
import { characterFor } from '@ab/mascot'
import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { HandCard, leadTag } from '../../components/HandCard'
import { MascotBadge } from '../../components/MascotBadge'
import { PlayingCard } from '../../components/PlayingCard'
import { chips, signedChips } from '../../lib/format'
import { FILTERS, filterHands, loadGames, loadHands } from '../../lib/replays'

export const metadata: Metadata = { title: 'Replays · artificialBluff' }

/** The hand shown at the top: the biggest pot of the game, else the newest hand. */
const featuredHand = (hands: HandSummary[]) => hands.find((h) => h.tags.includes('biggest-pot')) ?? hands[0]

export default async function Replays({ searchParams }: { searchParams: Promise<{ game?: string; tag?: string }> }) {
  await connection()
  const { game: wanted, tag = 'all' } = await searchParams
  const games = await loadGames()
  if (games === null)
    return (
      <div className="page">
        <h1>Replays</h1>
        <p className="warn">The live server isn&apos;t reachable right now.</p>
      </div>
    )
  const game = games.find((g) => g.id === wanted) ?? games[0]
  const hands = game ? ((await loadHands(game.id)) ?? []) : []
  const shown = filterHands(hands, tag)
  const featured = featuredHand(hands)
  const running = game?.status === 'running'

  return (
    <div className="page replays">
      <span className="kicker">REPLAYS</span>
      <h1>Every hand, kept</h1>
      <p className="lede">
        Each replay plays back at the pace it happened, with all hole cards face up, the win chances the players never saw, and what each model said it was
        thinking before it acted.
      </p>

      {games.length === 0 || !game ? (
        <p className="muted">No games yet. The first live game will show up here.</p>
      ) : (
        <>
          <div className="chips-row">
            {FILTERS.map((f) => (
              <Link key={f.id} href={`/replays?game=${encodeURIComponent(game.id)}&tag=${f.id}`} className={`chip${tag === f.id ? ' on' : ''}`}>
                {f.label}
              </Link>
            ))}
          </div>

          {featured ? (
            <section className="card featured">
              <div className="featured-main">
                <span className="tag-chip">FEATURED · HAND {featured.number}</span>
                <h2>{featured.headline}</h2>
                <div className="featured-cards">
                  {featured.shown.length ? (
                    <span className="muted">
                      {featured.shown.map((id) => characterFor(id).name).join(', ')} showed their cards
                    </span>
                  ) : (
                    <span className="muted">Nobody had to show their cards</span>
                  )}
                </div>
                <Link className="watch" href={`/replays/${encodeURIComponent(game.id)}?hand=${featured.number}`}>
                  Watch this hand
                </Link>
              </div>
              <div className="featured-side">
                <span className="k">WHO WAS IN IT</span>
                {featured.players.map((id, i) => (
                  <div className="featured-player" key={id}>
                    <MascotBadge playerId={id} index={i} size={26} />
                    <b>{characterFor(id, i).name}</b>
                    <span className={featured.winners.includes(id) ? 'up' : 'down'}>{featured.winners.includes(id) ? `won ${chips(featured.pot)}` : ''}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <div className="games-row">
            <span className="k">GAME</span>
            {games.slice(0, 8).map((g) => (
              <Link key={g.id} href={`/replays?game=${encodeURIComponent(g.id)}&tag=${tag}`} className={`chip${g.id === game.id ? ' on' : ''}`}>
                {new Date(g.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                {g.status === 'running' ? ' · live' : ''}
              </Link>
            ))}
          </div>

          <p className="muted">
            {shown.length} {shown.length === 1 ? 'hand' : 'hands'}
            {tag === 'all' ? '' : ` tagged ${FILTERS.find((f) => f.id === tag)?.label.toLowerCase()}`} · newest first
          </p>
          <div className="hand-grid">
            {shown.map((h, i) => (
              <HandCard key={h.handId} hand={h} live={running && i === 0} />
            ))}
          </div>
          {shown.length === 0 ? <p className="muted">No hands like that in this game.</p> : null}
        </>
      )}
    </div>
  )
}
