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
  | 'reraise_2_5x'
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
  /** Raise amounts are rounded to a multiple of this (the small blind is used if the big blind isn't a multiple). */
  chipUnit: number
  /** A sized option within this fraction of an already-offered amount is dropped as a near-duplicate. */
  minGap: number
}

export const DEFAULT_MENU_CONFIG: MenuConfig = { chipUnit: 25, minGap: 0.05 }

const fmt = (n: number) => n.toLocaleString('en-US')

/**
 * The shared action menu: the only choices any player (Jev or LLM) is ever offered.
 * Every option is legal; options that land on the same (or a nearly identical) amount are
 * merged, first id wins, so record the chip amount with each decision rather than relying on ids.
 *
 * Sizes:
 * - Preflop, unopened: open to 2.5 / 3 / 4 bb, plus 1 bb per limper.
 * - Preflop, facing a raise: re-raise to 2.5x or 3x the current bet, plus 1x per caller.
 * - Postflop: bet or raise to currentBet + f x (pot + to call), f in 1/3, 1/2, 3/4, 1, 1.5.
 * - Always min-raise and all-in when raising is legal.
 */
export function buildMenu(state: HandState, config: Partial<MenuConfig> = {}): MenuOption[] {
  if (state.toAct === null) return []
  const { chipUnit, minGap } = { ...DEFAULT_MENU_CONFIG, ...config }
  if (!Number.isInteger(chipUnit) || chipUnit <= 0) throw new Error('chipUnit must be a positive integer')
  const legal = legalActions(state)
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
    const unit = bb % chipUnit === 0 ? chipUnit : state.config.smallBlind
    const round = (x: number) => Math.max(unit, Math.round(x / unit) * unit)
    const verb = state.currentBet === 0 ? 'Bet' : 'Raise to'
    const candidates: Array<[OptionId, number]> = [['min_raise', min]]

    if (state.street === 'preflop') {
      const preflop = state.history.filter((h) => h.street === 'preflop')
      const opened = preflop.some((h) => h.kind === 'raise' || h.kind === 'bet')
      if (!opened) {
        const limpers = preflop.filter((h) => h.kind === 'call').length
        candidates.push(
          ['open_2_5bb', round((2.5 + limpers) * bb)],
          ['open_3bb', round((3 + limpers) * bb)],
          ['open_4bb', round((4 + limpers) * bb)],
        )
      } else {
        // Players who have put in the full current bet, other than the raiser and the actor.
        const matched = state.seats.filter(
          (s) => !s.folded && s !== seat && s.streetCommitted === state.currentBet,
        ).length
        const callers = Math.max(0, matched - 1)
        candidates.push(
          ['reraise_2_5x', round((2.5 + callers) * state.currentBet)],
          ['reraise_3x', round((3 + callers) * state.currentBet)],
        )
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

    const kept: number[] = []
    // Also drop sizes within minGap of all-in: the all-in option covers them.
    const tooClose = (to: number) => max - to <= minGap * to || kept.some((k) => Math.abs(to - k) <= minGap * k)
    for (const [id, to] of candidates) {
      if (to < min || to >= max || tooClose(to)) continue
      kept.push(to)
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
