import type { TableView } from '@ab/core/view'
import type { Moment } from '@ab/mascot'

/** A loss this big (in big blinds) makes a mascot sad. */
export const BIG_LOSS_BB = 20

export interface SeatMoment {
  moment: Moment
  /** Jev just decided: its comet plays before the reaction. */
  jevDecided: boolean
  /** Changes exactly when the mascot should replay its cue. */
  key: string
}

/**
 * Which spec §8 moment a seat is in, from the table view alone (so live, replays and tests agree):
 * out → eliminated; their turn → deciding; hand over → won (any pot share) or lost big; otherwise their
 * last action this hand (a fallback shows as confused). Jev's comet plays when its decision is the
 * table's latest.
 */
export function seatMoment(view: TableView, playerId: string): SeatMoment {
  const seat = view.seats.find((s) => s.playerId === playerId)
  const hand = view.hand
  const handId = hand?.handId ?? 'none'
  if (!seat) return { moment: 'waiting', jevDecided: false, key: `${handId}:unknown` }
  if (seat.status === 'out') return { moment: 'eliminated', jevDecided: false, key: 'out' }
  if (!hand) return { moment: 'waiting', jevDecided: false, key: 'no-hand' }
  if (hand.toAct === playerId) return { moment: 'deciding', jevDecided: false, key: `${handId}:turn:${seat.decisions}` }
  if (hand.ended) {
    if (hand.awards.some((a) => (a.shares[playerId] ?? 0) > 0)) return { moment: 'won', jevDecided: false, key: `${handId}:won` }
    if (seat.committed >= BIG_LOSS_BB * hand.bigBlind) return { moment: 'lost_big', jevDecided: false, key: `${handId}:lost` }
  }
  const last = seat.lastAction
  if (!last) return { moment: 'waiting', jevDecided: false, key: `${handId}:wait` }
  const latest = view.lastDecision?.playerId === playerId && view.lastDecision.handId === hand.handId
  const moment: Moment =
    latest && view.lastDecision!.fallback
      ? 'fallback'
      : last.optionId === 'fold'
        ? 'fold'
        : last.optionId === 'all_in'
          ? 'all_in'
          : last.optionId === 'check' || last.optionId === 'call'
            ? 'check_call'
            : 'raise'
  return { moment, jevDecided: latest && seat.kind === 'jev', key: `${handId}:${seat.decisions}:${moment}` }
}
