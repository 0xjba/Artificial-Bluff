import type { FallbackKind } from '@ab/core'
import type { HandRecord } from './hands'

/** Linear-interpolation quantile (R type 7); null for no values. */
export function quantile(values: readonly number[], q: number): number | null {
  if (!(q >= 0 && q <= 1)) throw new Error('quantile: q must be in [0, 1]')
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const h = (sorted.length - 1) * q
  const lo = Math.floor(h)
  const hi = Math.ceil(h)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (h - lo)
}

export interface PlayStyle {
  /** Share of hands the player voluntarily put chips in preflop (call or raise). */
  vpip: number | null
  /** Share of hands the player raised preflop. */
  pfr: number | null
  /** Aggression factor: postflop bets and raises per postflop call. */
  af: number | null
  /** Went to showdown: share of hands seen to the flop that reached showdown. */
  wtsd: number | null
}

export interface PlayerMetrics {
  playerId: string
  hands: number
  decisions: number
  costUsd: number
  costPerDecisionUsd: number | null
  costPer100HandsUsd: number | null
  meanInputTokens: number | null
  meanOutputTokens: number | null
  meanReasoningTokens: number | null
  /** Latency per decision in ms (timeouts count at the time limit). */
  latencyP50Ms: number | null
  latencyP95Ms: number | null
  latencyMeanMs: number | null
  fallbacks: Record<FallbackKind, number>
  /** Share of decisions that fell back to check/fold, any kind. */
  fallbackRate: number | null
  /** Share of decisions that needed a retry. */
  retryRate: number | null
  style: PlayStyle
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null)
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

/** Cost, latency, reliability and play style of one player over the given hands. */
export function playerMetrics(hands: readonly HandRecord[], playerId: string): PlayerMetrics {
  const seated = hands.filter((h) => h.seats.some((s) => s.playerId === playerId))
  const decisions = seated.flatMap((h) => h.decisions.filter((d) => d.playerId === playerId))
  const costUsd = decisions.reduce((s, d) => s + d.costUsd, 0)
  const fallbacks: Record<FallbackKind, number> = { model: 0, infra: 0, timeout: 0, auto: 0 }
  for (const d of decisions) if (d.fallbackKind) fallbacks[d.fallbackKind]++

  let vpip = 0
  let pfr = 0
  let aggressive = 0
  let calls = 0
  let sawFlop = 0
  let showdowns = 0
  for (const h of seated) {
    const mine = h.decisions.filter((d) => d.playerId === playerId)
    const pre = mine.filter((d) => d.street === 'preflop')
    if (pre.some((d) => d.actionType === 'call' || d.actionType === 'raise')) vpip++
    if (pre.some((d) => d.actionType === 'raise')) pfr++
    for (const d of mine) {
      if (d.street === 'preflop') continue
      if (d.actionType === 'raise') aggressive++
      else if (d.actionType === 'call') calls++
    }
    if (h.sawFlop.includes(playerId)) {
      sawFlop++
      if (h.showdown.includes(playerId)) showdowns++
    }
  }

  return {
    playerId,
    hands: seated.length,
    decisions: decisions.length,
    costUsd,
    costPerDecisionUsd: ratio(costUsd, decisions.length),
    costPer100HandsUsd: seated.length ? (costUsd / seated.length) * 100 : null,
    meanInputTokens: mean(decisions.map((d) => d.inputTokens)),
    meanOutputTokens: mean(decisions.map((d) => d.outputTokens)),
    meanReasoningTokens: mean(decisions.map((d) => d.reasoningTokens)),
    latencyP50Ms: quantile(decisions.map((d) => d.latencyMs), 0.5),
    latencyP95Ms: quantile(decisions.map((d) => d.latencyMs), 0.95),
    latencyMeanMs: mean(decisions.map((d) => d.latencyMs)),
    fallbacks,
    fallbackRate: ratio(decisions.filter((d) => d.fallback).length, decisions.length),
    retryRate: ratio(decisions.filter((d) => d.retries > 0).length, decisions.length),
    style: { vpip: ratio(vpip, seated.length), pfr: ratio(pfr, seated.length), af: ratio(aggressive, calls), wtsd: ratio(showdowns, sawFlop) },
  }
}
