import { legalActions, potSize } from './hand'
import type { Action, HandState } from './types'

export type OptionId =
  | 'fold'
  | 'check'
  | 'call'
  | 'min_raise'
  | 'open_2_5bb'
  | 'open_3bb'
  | 'open_4bb'
  | 'reraise_3x'
  | 'pot_33'
  | 'pot_50'
  | 'pot_75'
  | 'pot_100'
  | 'pot_150'
  | 'all_in'

export interface MenuOption {
  id: OptionId
  /** Spectator/model-facing label, e.g. "Raise to 300". */
  label: string
  action: Action
  /** Chips this option moves from the stack into the pot. */
  cost: number
}

export interface MenuConfig {
  /** Raise amounts are rounded to a multiple of this. */
  chipUnit: number
}

const fmt = (n: number) => n.toLocaleString('en-US')

/**
 * The shared action menu: the only choices any player (Jev or LLM) is ever offered.
 * Every option is legal; options that land on the same amount are merged (first id wins).
 */
export function buildMenu(state: HandState, config: MenuConfig = { chipUnit: 25 }): MenuOption[] {
  const legal = legalActions(state)
  if (state.toAct === null) return []
  const seat = state.seats[state.toAct]!
  const options: MenuOption[] = []

  if (legal.canFold) options.push({ id: 'fold', label: 'Fold', action: { type: 'fold' }, cost: 0 })
  if (legal.canCheck) options.push({ id: 'check', label: 'Check', action: { type: 'check' }, cost: 0 })
  if (legal.callAmount > 0) {
    const allIn = legal.callAmount === seat.stack
    options.push({
      id: 'call',
      label: allIn ? `Call all-in ${fmt(legal.callAmount)}` : `Call ${fmt(legal.callAmount)}`,
      action: { type: 'call' },
      cost: legal.callAmount,
    })
  }

  if (legal.minRaiseTo !== null && legal.maxRaiseTo !== null) {
    const min = legal.minRaiseTo
    const max = legal.maxRaiseTo
    const bb = state.config.bigBlind
    const unit = config.chipUnit
    const round = (x: number) => Math.max(unit, Math.round(x / unit) * unit)
    const verb = state.currentBet === 0 ? 'Bet' : 'Raise to'
    const candidates: Array<[OptionId, number]> = [['min_raise', min]]

    if (state.street === 'preflop') {
      const unopened = state.currentBet === bb && state.history.every((h) => h.kind !== 'raise' && h.kind !== 'bet')
      if (unopened) {
        candidates.push(['open_2_5bb', round(2.5 * bb)], ['open_3bb', round(3 * bb)], ['open_4bb', round(4 * bb)])
      } else {
        candidates.push(['reraise_3x', round(3 * state.currentBet)])
      }
    } else {
      const toCall = state.currentBet - seat.streetCommitted
      const base = potSize(state) + toCall
      const fractions: Array<[OptionId, number]> = [
        ['pot_33', 1 / 3],
        ['pot_50', 0.5],
        ['pot_75', 0.75],
        ['pot_100', 1],
        ['pot_150', 1.5],
      ]
      for (const [id, f] of fractions) candidates.push([id, round(state.currentBet + f * base)])
    }

    const seen = new Set<number>()
    for (const [id, to] of candidates) {
      if (to < min || to >= max || seen.has(to)) continue
      seen.add(to)
      options.push({
        id,
        label: `${verb} ${fmt(to)}`,
        action: { type: 'raise', to },
        cost: to - seat.streetCommitted,
      })
    }
    options.push({
      id: 'all_in',
      label: `All-in ${fmt(max)}`,
      action: { type: 'raise', to: max },
      cost: max - seat.streetCommitted,
    })
  }
  return options
}
