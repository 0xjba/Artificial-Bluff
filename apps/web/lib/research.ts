import type { ModelsTable, SeatSummary } from '@ab/server'
import { characterFor } from '@ab/mascot'
import { ms, pct, usd } from './format'

export interface Metric {
  value: string
  what: string
}

const gapPts = (s: SeatSummary) => (s.honestyGapPts === null ? null : Math.abs(s.honestyGapPts))
const best = <T>(xs: T[], by: (x: T) => number | null) => xs.filter((x) => by(x) !== null).sort((a, b) => by(a)! - by(b)!)[0] ?? null
const worst = <T>(xs: T[], by: (x: T) => number | null) => xs.filter((x) => by(x) !== null).sort((a, b) => by(b)! - by(a)!)[0] ?? null
const who = (s: SeatSummary) => characterFor(s.playerId).name

/**
 * A headline that only says what the numbers say: which seat stated the closest win chances, and
 * whether the cheapest seat is the same one.
 */
export function researchHeadline(table: ModelsTable): string {
  const honest = best(table.seats, gapPts)
  const cheap = best(table.seats, (s) => s.costPerDecisionUsd)
  if (!honest || !cheap) return 'Not enough hands yet to say anything.'
  if (honest.playerId === cheap.playerId) return `The cheapest seat is also the one whose stated chances sit closest to the truth: ${who(honest)}.`
  return `${who(honest)} states the chances closest to the truth; ${who(cheap)} costs the least per decision.`
}

/** A ratio is only worth a tile when the two seats really differ. */
export const RATIO_WORTH_SHOWING = 1.5

/** The figures under the headline, each straight from the event log. */
export function researchMetrics(table: ModelsTable): Metric[] {
  const honest = best(table.seats, gapPts)
  const loud = worst(table.seats, gapPts)
  const cheap = best(table.seats, (s) => s.costPerDecisionUsd)
  const dear = worst(table.seats, (s) => s.costPerDecisionUsd)
  const quick = best(table.seats, (s) => s.latencyMeanMs)
  const slow = worst(table.seats, (s) => s.latencyMeanMs)
  const decisions = table.seats.reduce((sum, s) => sum + s.decisions, 0)
  const fallbacks = table.seats.reduce((sum, s) => sum + s.fallbacks, 0)
  const metrics: Metric[] = []
  if (honest) metrics.push({ value: `${gapPts(honest)!.toFixed(0)} pts`, what: `average gap between ${who(honest)}'s stated win chance and the true one` })
  if (loud && loud.playerId !== honest?.playerId) metrics.push({ value: `${gapPts(loud)!.toFixed(0)} pts`, what: `the same gap for ${who(loud)}, the furthest from the truth` })
  if (cheap && dear && cheap.costPerDecisionUsd && dear.costPerDecisionUsd && cheap.playerId !== dear.playerId) {
    const ratio = dear.costPerDecisionUsd / cheap.costPerDecisionUsd
    metrics.push(
      ratio >= RATIO_WORTH_SHOWING
        ? {
            value: `${ratio.toFixed(0)}×`,
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
  metrics.push({ value: decisions.toLocaleString('en-US'), what: `decisions logged across ${table.hands} hands, each with the chance its model claimed` })
  metrics.push({ value: `${fallbacks} of ${decisions}`, what: 'decisions where a seat had to be played check-or-fold after a timeout or an invalid answer' })
  const winners = table.seats.filter((s) => s.winRate !== null)
  if (winners.length) metrics.push({ value: pct(winners[0]!.winRate), what: `hands won by ${who(winners[0]!)}, the seat with the most chips` })
  return metrics
}
