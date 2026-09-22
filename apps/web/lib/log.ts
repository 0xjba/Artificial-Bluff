import type { GameEvent, TableView } from '@ab/core/view'
import { card, chips, fallbackNotice } from './format'

export interface LogLine {
  seq: number
  /** When it happened (the event's timestamp, ms). */
  ts: number
  text: string
  kind: 'hand' | 'action' | 'street' | 'win' | 'end'
  /** Short label shown beside the line: HAND, FOLD, CHECK, CALL, BET, RAISE, ALL-IN, FLOP, TURN, RIVER, WIN, SPLIT, END. */
  tag: string
  /** The hand number, on 'hand' lines. */
  hand?: number
}

/** The tag for a decision's menu label. */
function actionTag(label: string): string {
  if (/^(Call all-in|All-in)/.test(label)) return 'ALL-IN'
  const m = /^(Fold|Check|Call|Bet|Raise)/.exec(label)
  return m ? m[1]!.toUpperCase() : 'ACT'
}

/**
 * A decision's menu label ("Raise to 1,300", "Call all-in 150") as a third-person verb phrase. An all-in
 * raise shows the total it raises to (as the menu does), not the chips added.
 */
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
      return `goes all-in (${amount})`
  }
}

const cardText = (c: string) => {
  const x = card(c)
  return `${x.rank}${x.suit}\uFE0E`
}

/**
 * One plain-English line for the action log, or null for events that don't need one. `name` maps
 * player ids to characters; `view` is the table before this event (for the hand number and the
 * showdown hands a pot was won with).
 */
export function logLine(e: GameEvent, name: (id: string) => string, view: TableView): LogLine | null {
  const at = { seq: e.seq, ts: e.ts }
  switch (e.type) {
    case 'hand_started': {
      const hand = view.handsPlayed + 1
      return { ...at, kind: 'hand', tag: 'HAND', hand, text: `Hand ${hand} · blinds ${chips(e.smallBlind)}/${chips(e.bigBlind)}` }
    }
    case 'decision': {
      const why = e.fallback ? ` (${fallbackNotice(e.fallbackKind, e.fallbackReason)})` : ''
      return { ...at, kind: 'action', tag: actionTag(e.label), text: `${name(e.playerId)} ${describe(e.label)}${why}` }
    }
    case 'street_dealt':
      return { ...at, kind: 'street', tag: e.street.toUpperCase(), text: e.cards.map(cardText).join(' ') }
    case 'pot_awarded': {
      const who = e.winners.map(name).join(' & ')
      const split = e.winners.length > 1
      const shown = view.hand?.showdown?.[e.winners[0] ?? '']
      const how = shown ? ` with ${shown.label.toLowerCase()}` : !view.hand?.showdown && e.eligible.length === 1 ? ' (everyone else folded)' : ''
      return { ...at, kind: 'win', tag: split ? 'SPLIT' : 'WIN', text: `${who} ${split ? 'split' : 'wins'} ${chips(e.amount)}${how}` }
    }
    case 'game_ended':
      return {
        ...at,
        kind: 'end',
        tag: 'END',
        text: e.winner ? `${name(e.winner)} wins the game (${e.reason.replace('_', ' ')})` : `Game over (${e.reason.replace('_', ' ')})`,
      }
    default:
      return null
  }
}
