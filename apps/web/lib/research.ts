import type { ModelsTable, SeatSummary } from '@ab/server'
import { characterFor } from '@ab/mascot'
import { ms, pct, usd } from './format'

export interface Metric {
  value: string
  what: string
}

const errorPts = (s: SeatSummary) => s.errorPts
const best = <T>(xs: T[], by: (x: T) => number | null) => xs.filter((x) => by(x) !== null).sort((a, b) => by(a)! - by(b)!)[0] ?? null
const worst = <T>(xs: T[], by: (x: T) => number | null) => xs.filter((x) => by(x) !== null).sort((a, b) => by(b)! - by(a)!)[0] ?? null
const who = (s: SeatSummary) => characterFor(s.playerId).name

/**
 * A headline that only says what the numbers say: which seat stated the closest win chances, and
 * whether the cheapest seat is the same one.
 */
export function researchHeadline(table: ModelsTable): string {
  const honest = best(table.seats, errorPts)
  const cheap = best(table.seats, (s) => s.costPerDecisionUsd)
  if (!honest || !cheap) return 'Not enough hands yet to say anything.'
  if (honest.playerId === cheap.playerId) return `The cheapest seat is also the one whose stated chances sit closest to the truth: ${who(honest)}.`
  return `${who(honest)} states the chances closest to the truth; ${who(cheap)} costs the least per decision.`
}

/** A ratio is only worth a tile when the two seats really differ. */
export const RATIO_WORTH_SHOWING = 1.5

/** The figures under the headline, each straight from the event log. */
export function researchMetrics(table: ModelsTable): Metric[] {
  const honest = best(table.seats, errorPts)
  const loud = worst(table.seats, errorPts)
  const cheap = best(table.seats, (s) => s.costPerDecisionUsd)
  const dear = worst(table.seats, (s) => s.costPerDecisionUsd)
  const quick = best(table.seats, (s) => s.latencyMeanMs)
  const slow = worst(table.seats, (s) => s.latencyMeanMs)
  const decisions = table.seats.reduce((sum, s) => sum + s.decisions, 0)
  const fallbacks = table.seats.reduce((sum, s) => sum + s.fallbacks, 0)
  const metrics: Metric[] = []
  if (honest) metrics.push({ value: `${errorPts(honest)!.toFixed(0)} pts`, what: `${who(honest)}'s stated win chance sits this far from the true one, on average` })
  if (loud && loud.playerId !== honest?.playerId) metrics.push({ value: `${errorPts(loud)!.toFixed(0)} pts`, what: `the same for ${who(loud)}, the furthest from the truth` })
  const leaner = worst(table.seats, (x) => (x.biasPts === null ? null : Math.abs(x.biasPts)))
  if (leaner && leaner.biasPts !== null && Math.abs(leaner.biasPts) >= 3) {
    metrics.push({
      value: `${leaner.biasPts > 0 ? '+' : '−'}${Math.abs(leaner.biasPts).toFixed(0)} pts`,
      what: `${who(leaner)} ${leaner.biasPts > 0 ? 'talks itself up' : 'talks itself down'} by this much on average, over and under cancelled`,
    })
  }
  if (cheap && dear && cheap.costPerDecisionUsd && dear.costPerDecisionUsd && cheap.playerId !== dear.playerId) {
    const ratio = dear.costPerDecisionUsd / cheap.costPerDecisionUsd
    metrics.push(
      ratio >= RATIO_WORTH_SHOWING
        ? {
            value: `${ratio.toFixed(ratio < 10 ? 1 : 0)}×`,
            what: `cheaper per decision: ${usd(cheap.costPerDecisionUsd)} for ${who(cheap)} against ${usd(dear.costPerDecisionUsd)} for ${who(dear)}`,
          }
        : { value: usd(cheap.costPerDecisionUsd), what: `per decision for ${who(cheap)}; every seat costs about the same` },
    )
  }
  if (quick && slow && quick.latencyMeanMs && slow.latencyMeanMs && quick.playerId !== slow.playerId) {
    const ratio = slow.latencyMeanMs / quick.latencyMeanMs
    metrics.push(
      ratio >= RATIO_WORTH_SHOWING
        ? {
            value: `${ratio.toFixed(1)}×`,
            what: `faster to a decision: ${ms(quick.latencyMeanMs)} for ${who(quick)} against ${ms(slow.latencyMeanMs)} for ${who(slow)}`,
          }
        : { value: ms(quick.latencyMeanMs), what: `to a decision for ${who(quick)}; every seat answers at about the same speed` },
    )
  }
  const hands = `${table.hands} ${table.hands === 1 ? 'hand' : 'hands'}`
  metrics.push({ value: decisions.toLocaleString('en-US'), what: `decisions logged across ${hands}, each with the chance its model claimed` })
  metrics.push({
    value: `${fallbacks} of ${decisions.toLocaleString('en-US')}`,
    what: 'decisions where a seat had to be played check-or-fold after a timeout or an invalid answer',
  })
  const leader = table.seats[0] // sorted by chips won
  if (leader && leader.winRate !== null) metrics.push({ value: pct(leader.winRate), what: `of its hands won by ${who(leader)}, the seat that won the most chips` })
  return metrics
}
