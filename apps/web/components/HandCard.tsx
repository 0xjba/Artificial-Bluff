import type { HandSummary } from '@ab/server'
import { characterFor } from '@ab/mascot'
import Link from 'next/link'
import { chips } from '../lib/format'
import { MascotBadge } from './MascotBadge'

const TAG_LABEL: Record<string, string> = {
  'biggest-pot': 'BIGGEST POT',
  showdown: 'SHOWDOWN',
  elimination: 'KNOCK-OUT',
  split: 'SPLIT POT',
  timeout: 'TIMEOUT',
  'jev-vs-llm': 'JEV VS LLM',
  'worst-read': 'WORST READ',
}

/** The badge a hand leads with: its most notable tag. */
export const leadTag = (h: HandSummary) =>
  (['elimination', 'worst-read', 'biggest-pot', 'jev-vs-llm', 'split', 'timeout', 'showdown'] as const).find((t) => (h.tags as string[]).includes(t)) ?? null

/** One hand in the replays list. */
export function HandCard({ hand, live }: { hand: HandSummary; live?: boolean }) {
  const tag = leadTag(hand)
  const winners = hand.winners.map((id) => characterFor(id).name).join(' and ')
  return (
    <article className="card hand-card">
      <div className="hand-card-top">
        <span className="tag-chip">{live ? 'IN PROGRESS' : (tag && TAG_LABEL[tag]) || 'HAND'}</span>
        <span className="hand-no">
          HAND {hand.number} · {new Date(hand.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <h3>{hand.headline}</h3>
      <div className="hand-card-foot">
        <span className="faces">
          {hand.players.map((id, i) => (
            <MascotBadge key={id} playerId={id} index={i} size={22} />
          ))}
        </span>
        <span className="pot">POT {chips(hand.pot)}</span>
      </div>
      <div className="hand-card-foot">
        <span className="muted">
          {winners} {hand.winners.length > 1 ? 'split' : 'wins'} {chips(hand.pot)}
        </span>
        <Link href={`/replays/${encodeURIComponent(hand.gameId)}?hand=${hand.number}`}>Watch →</Link>
      </div>
    </article>
  )
}
