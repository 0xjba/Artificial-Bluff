import type { GameEvent, TableView } from '@ab/core/view'
import { card, chips, fallbackNotice } from './format'

export interface LogLine {
  seq: number
  text: string
  kind: 'hand' | 'action' | 'street' | 'win' | 'end'
}

/** A decision's menu label ("Raise to 1,300", "Call all-in 150") as a third-person verb phrase. */
function describe(label: string): string {
  const m = /^(Fold|Check|Call all-in|Call|Bet|Raise to|All-in)\s*(.*)$/.exec(label)
  if (!m) return label.toLowerCase()
  const amount = m[2] ?? ''
  switch (m[1]) {
    case 'Fold':
      return 'folds'
    case 'Check':
      return 'checks'
    case 'Call all-in':
      return `calls all-in for ${amount}`
    case 'Call':
      return `calls ${amount}`
    case 'Bet':
      return `bets ${amount}`
    case 'Raise to':
      return `raises to ${amount}`
    default:
      return `goes all-in for ${amount}`
  }
}

const cardText = (c: string) => {
  const x = card(c)
  return `${x.rank}${x.suit}`
}

/**
 * One plain-English line for the action log, or null for events that don't need one. `name` maps
 * player ids to characters; `view` is the table before this event (for the hand number and the
 * showdown hands a pot was won with).
 */
export function logLine(e: GameEvent, name: (id: string) => string, view: TableView): LogLine | null {
  switch (e.type) {
    case 'hand_started':
      return { seq: e.seq, kind: 'hand', text: `Hand ${view.handsPlayed + 1} · blinds ${chips(e.smallBlind)}/${chips(e.bigBlind)}` }
    case 'decision': {
      const why = e.fallback ? ` (${fallbackNotice(e.fallbackKind, e.fallbackReason)})` : ''
      return { seq: e.seq, kind: 'action', text: `${name(e.playerId)} ${describe(e.label)}${why}` }
    }
    case 'street_dealt': {
      const street = e.street.charAt(0).toUpperCase() + e.street.slice(1)
      return { seq: e.seq, kind: 'street', text: `${street}: ${e.cards.map(cardText).join(' ')}` }
    }
    case 'pot_awarded': {
      const who = e.winners.map(name).join(' & ')
      const verb = e.winners.length > 1 ? 'split' : 'wins'
      const shown = view.hand?.showdown?.[e.winners[0] ?? '']
      const how = shown ? ` with ${shown.label.toLowerCase()}` : !view.hand?.showdown && e.eligible.length === 1 ? ' (everyone else folded)' : ''
      return { seq: e.seq, kind: 'win', text: `${who} ${verb} ${chips(e.amount)}${how}` }
    }
    case 'game_ended':
      return { seq: e.seq, kind: 'end', text: e.winner ? `${name(e.winner)} wins the game (${e.reason.replace('_', ' ')})` : `Game over (${e.reason.replace('_', ' ')})` }
    default:
      return null
  }
}
