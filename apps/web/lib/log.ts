import type { GameEvent } from '@ab/core/view'
import { chips, ms } from './format'

export interface LogLine {
  seq: number
  text: string
  kind: 'hand' | 'action' | 'street' | 'win' | 'end'
}

/** One line for the action log, or null for events that don't need one. `name` maps player ids to characters. */
export function logLine(e: GameEvent, name: (id: string) => string): LogLine | null {
  switch (e.type) {
    case 'hand_started':
      return { seq: e.seq, kind: 'hand', text: `${e.handId ?? 'Hand'} · blinds ${chips(e.smallBlind)}/${chips(e.bigBlind)}` }
    case 'decision': {
      const why = e.fallback ? ` (fallback: ${e.fallbackKind ?? 'auto'})` : ''
      return { seq: e.seq, kind: 'action', text: `${name(e.playerId)} ${e.label.toLowerCase()} · ${ms(e.latencyMs)}${why}` }
    }
    case 'street_dealt':
      return { seq: e.seq, kind: 'street', text: `${e.street.toUpperCase()} ${e.cards.join(' ')}` }
    case 'pot_awarded':
      return { seq: e.seq, kind: 'win', text: `${e.winners.map(name).join(' & ')} ${e.winners.length > 1 ? 'split' : 'wins'} ${chips(e.amount)}` }
    case 'game_ended':
      return { seq: e.seq, kind: 'end', text: e.winner ? `${name(e.winner)} wins the game (${e.reason.replace('_', ' ')})` : `Game over (${e.reason.replace('_', ' ')})` }
    default:
      return null
  }
}
