'use client'
import { characterFor, cueFor, EYE_INK, Mascot } from '@ab/mascot'

/** A seat's mascot, still, for tables and lists. */
export function MascotBadge({ playerId, index, size = 30 }: { playerId: string; index: number; size?: number }) {
  const who = characterFor(playerId, index)
  return <Mascot shape={who.shape} cue={cueFor('waiting')} size={size} ink={who.color} paper={EYE_INK} frozenAt={99} title={who.name} />
}
