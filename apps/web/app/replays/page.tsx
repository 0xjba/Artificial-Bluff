import type { HandSummary } from '@ab/server'
import { characterFor } from '@ab/mascot'
import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { HandCard } from '../../components/HandCard'
import { MascotBadge } from '../../components/MascotBadge'
import { chips, clock, shortModel, signedChips } from '../../lib/format'
import { FILTERS, filterHands, loadGames, loadHands } from '../../lib/replays'
import styles from './replays.module.css'

export const metadata: Metadata = { title: 'Replays · artificialBluff' }

/** The hand shown at the top: the biggest pot of the game, else the newest hand. */
const featuredHand = (hands: HandSummary[]) => hands.find((h) => h.tags.includes('biggest-pot')) ?? hands[0]

/** How long the hand took, as the design writes it: 3:44. */
const length = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

const WAY = ['', 'ONE WAY', 'TWO WAY', 'THREE WAY', 'FOUR WAY', 'FIVE WAY', 'SIX WAY']

/** What the seats said about their chances, against what was true. */
function readsLine(hand: HandSummary): string | null {
  if (!hand.reads.length) return null
  return `${hand.reads
    .map((r) => `${characterFor(r.playerId).name} put its chances at ${Math.round(r.saidPts)}% with ${Math.round(r.truePts)}% to win`)
    .join('; ')}.`
}

export default async function Replays({ searchParams }: { searchParams: Promise<{ game?: string; tag?: string }> }) {
  await connection()
  const { game: wanted, tag = 'all' } = await searchParams
  const games = await loadGames()
  if (games === null)
    return (
      <div className={styles.replays}>
        <header className={styles['replays-head']}>
          <span className={styles.kicker}>REPLAYS</span>
          <h1>Every hand these models have played</h1>
          <p className="warn">The live server isn&apos;t reachable right now.</p>
        </header>
      </div>
    )
  const game = games.find((g) => g.id === wanted) ?? games[0]
  const hands = game ? ((await loadHands(game.id)) ?? []) : []
  const shown = filterHands(hands, tag)
  const featured = featuredHand(hands)
  const live = games.find((g) => g.status === 'running')

  return (
    <div className={styles.replays}>
      {live ? (
        <div className={styles['live-now']}>
          <Link href="/">
            <span className="blip" />
            GAME LIVE NOW
          </Link>
        </div>
      ) : null}

      <header className={styles['replays-head']}>
        <span className={styles.kicker}>REPLAYS</span>
        <h1>Every hand these models have played</h1>
        <p>
          Each replay plays back at the pace it happened, with all hole cards face up, the win chances the players never saw, and what each model said it was
          thinking before it acted.
        </p>
      </header>

      {games.length === 0 || !game ? (
        <p className={`${styles['replays-empty']} muted`}>No games yet. The first live game will show up here.</p>
      ) : (
        <>
          <div className={styles.filters}>
            {FILTERS.map((f) => (
              <Link
                key={f.id}
                href={`/replays?game=${encodeURIComponent(game.id)}&tag=${f.id}`}
                className={`${styles.filter}${tag === f.id ? ` ${styles.on}` : ''}`}
                {...(tag === f.id ? { 'aria-current': 'page' as const } : {})}
              >
                {f.label}
              </Link>
            ))}
          </div>

          {featured ? (
            <div className={styles['featured-wrap']}>
              <div className={styles.featured}>
                <div className={styles['featured-main']}>
                  <div className={styles['featured-meta']}>
                    <span className={styles.tag}>FEATURED · HAND {featured.number}</span>
                    <span className={styles.meta}>
                      {length(featured.seconds)} · {featured.decisions} DECISIONS · {WAY[featured.players.length] ?? `${featured.players.length} WAY`}
                    </span>
                  </div>
                  <h2>{featured.headline}</h2>
                  {readsLine(featured) ? <p>{readsLine(featured)}</p> : null}
                  <div className={styles['featured-facts']}>
                    <span>POT {chips(featured.pot)}</span>
                    <span>BLINDS {chips(featured.bigBlind / 2)}/{chips(featured.bigBlind)}</span>
                    <span>{featured.shown.length ? `${featured.shown.length} SHOWED` : 'NO SHOWDOWN'}</span>
                    <span>{clock(featured.ts)}</span>
                  </div>
                  <div className={styles['featured-buttons']}>
                    <Link className={styles.watch} href={`/replays/${encodeURIComponent(game.id)}?hand=${featured.number}`}>
                      Watch this hand
                    </Link>
                    <a className={styles.log} href={`/api/games/${encodeURIComponent(game.id)}/events`}>
                      Open the event log
                    </a>
                  </div>
                </div>
                <div className={styles['featured-side']}>
                  <span className={styles.k}>WHO WAS IN IT</span>
                  {featured.players.map((id, i) => {
                    const who = characterFor(id, i)
                    const won = featured.won[id] ?? 0
                    return (
                      <div className={styles['featured-player']} key={id}>
                        <span className={styles.face}>
                          <MascotBadge playerId={id} index={i} size={28} />
                        </span>
                        <span className={styles.who}>
                          <b>{who.name}</b>
                          <small>{featured.shown.includes(id) ? 'showed its cards' : 'did not show'}</small>
                        </span>
                        <span className={styles.result}>
                          <b className={won > 0 ? styles.up : ''}>{won > 0 ? signedChips(won) : '—'}</b>
                          <small>{featured.busted.includes(id) ? 'knocked out' : won > 0 ? 'won the pot' : ''}</small>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : null}

          <div className={styles["replays-section"]}>
            <span className={styles.k}>ALL HANDS · {game.status === 'running' ? 'GAME IN PROGRESS' : `GAME ${new Date(game.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`}</span>
            <span className={styles.hint}>
              {shown.length} {shown.length === 1 ? 'hand' : 'hands'}
              {tag === 'all' ? '' : ` tagged ${FILTERS.find((f) => f.id === tag)?.label.toLowerCase()}`} · sorted newest first
            </span>
          </div>

          <div className={styles['hand-grid']}>
            {shown.map((h) => (
              <HandCard key={h.handId} hand={h} />
            ))}
          </div>
          {shown.length === 0 ? <p className={`${styles['replays-empty']} muted`}>No hands like that in this game.</p> : null}

          {games.length > 1 ? (
            <div className={styles['games-row']}>
              <span className={styles.k}>OTHER GAMES</span>
              {games.slice(0, 10).map((g) => (
                <Link
                  key={g.id}
                  href={`/replays?game=${encodeURIComponent(g.id)}&tag=${tag}`}
                  className={`${styles.filter}${g.id === game.id ? ` ${styles.on}` : ''}`}
                  {...(g.id === game.id ? { 'aria-current': 'page' as const } : {})}
                >
                  {new Date(g.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                  {g.status === 'running' ? ' · live' : ''}
                </Link>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
