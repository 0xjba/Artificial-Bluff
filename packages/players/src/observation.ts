import { buildMenu, legalActions, positions, potSize, type HandState, type MenuOption } from '@ab/engine'
import type { Observation, SeatView } from './types'

const round1 = (x: number) => Math.round(x * 10) / 10

const VERB: Record<string, string> = {
  post_sb: 'posts small blind',
  post_bb: 'posts big blind',
  fold: 'folds',
  check: 'checks',
  call: 'calls',
  bet: 'bets',
  raise: 'raises to',
}

/** The observation for the player to act. `menu` defaults to the engine's shared menu. */
export function buildObservation(state: HandState, menu: MenuOption[] = buildMenu(state)): Observation {
  if (state.toAct === null) throw new Error('buildObservation: nobody is to act')
  const me = state.seats[state.toAct]!
  const names = positions(state.seats.length, state.config.buttonIndex)
  const { smallBlind, bigBlind } = state.config

  const seats: SeatView[] = state.seats.map((s, i) => ({
    position: names[i]!,
    stack: s.stack,
    status: s.folded ? 'folded' : s.allIn ? 'all_in' : 'active',
    bet: s.streetCommitted,
    you: i === state.toAct,
  }))

  const history = state.history.map((h) => {
    const who = names[h.seatIndex]!
    const verb = VERB[h.kind]!
    const amount = h.kind === 'fold' || h.kind === 'check' ? '' : ` ${h.kind === 'call' || h.kind.startsWith('post') ? h.amount : h.to}`
    return `${h.street}: ${who} ${verb}${amount}${h.allIn ? ' (all-in)' : ''}`
  })

  const pot = potSize(state)
  const toCall = legalActions(state).callAmount
  // Only chips up to what this player can match are winnable; any excess goes back to its owner.
  const reach = me.handCommitted + toCall
  const winnablePot = state.seats.reduce((sum, s) => sum + Math.min(s.handCommitted, reach), 0)
  // Stacks and pot as they were when this street began, so SPR and effective stack don't drift mid-street.
  const opponents = state.seats.filter((s) => s !== me && !s.folded)
  const biggestOpponent = Math.max(0, ...opponents.map((s) => s.stack + s.streetCommitted))
  const effective = Math.min(me.stack + me.streetCommitted, biggestOpponent)
  const potAtStreetStart = pot - state.seats.reduce((sum, s) => sum + s.streetCommitted, 0)

  return {
    street: state.street,
    position: names[state.toAct]!,
    hole: [...me.hole],
    board: [...state.board],
    seats,
    history,
    facts: {
      smallBlind,
      bigBlind,
      pot,
      toCall,
      potOddsPct: toCall > 0 ? round1((100 * toCall) / (winnablePot + toCall)) : 0,
      effectiveStackBb: round1(effective / bigBlind),
      spr: state.street === 'preflop' ? null : round1(effective / Math.max(1, potAtStreetStart)),
    },
    options: menu.map((o) => ({ id: o.id, label: o.label })),
  }
}
