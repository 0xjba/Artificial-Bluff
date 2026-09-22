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

/** How long the hand took: 3:44. */
const length = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

/** One hand in the replays list (design: the card grid). */
export function HandCard({ hand }: { hand: HandSummary }) {
  const tag = leadTag(hand)
  const winners = hand.winners.map((id) => characterFor(id).name).join(' and ')
  const each = hand.winners.length > 1 ? (hand.won[hand.winners[0]!] ?? hand.pot / hand.winners.length) : hand.pot
  return (
    <Link className="hand-card" href={`/replays/${encodeURIComponent(hand.gameId)}?hand=${hand.number}`}>
      <span className="hand-card-top">
        <span className={`tag ${tag ?? 'hand'}`}>{(tag && TAG_LABEL[tag]) || 'HAND'}</span>
        <span className="when">
          HAND {hand.number} · {length(hand.seconds)}
        </span>
      </span>
      <span className="title">{hand.headline}</span>
      <span className="hand-card-seats">
        <span className="faces">
          {hand.players.map((id, i) => (
            <MascotBadge key={id} playerId={id} index={i} size={22} />
          ))}
        </span>
        <span className="pot">POT {chips(hand.pot)}</span>
      </span>
      <span className="hand-card-foot">
        <span className="winner">{hand.winners.length > 1 ? `${winners} take ${chips(each)} each` : `${winners} wins ${chips(hand.pot)}`}</span>
        <span className="watch">Watch →</span>
      </span>
    </Link>
  )
}
