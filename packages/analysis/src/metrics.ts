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
  /** Share of hands the player voluntarily put chips in preflop (call or raise); walks don't count. */
  vpip: number | null
  /** Share of hands the player raised preflop; walks don't count. */
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
  /**
   * Latency, tokens and cost per decision are over answered decisions: auto-played ones (the seat was
   * skipped after repeated failures, logged at 0 ms and $0) are left out. Timeouts count at the limit.
   */
  latencyP50Ms: number | null
  latencyP95Ms: number | null
  latencyMeanMs: number | null
  fallbacks: Record<FallbackKind, number>
  /** Share of decisions that fell back to check/fold, any kind. */
  fallbackRate: number | null
  /** Share of decisions that fell back because of the model's own output (invalid, empty, refused, truncated). */
  modelFallbackRate: number | null
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
  const answered = decisions.filter((d) => d.fallbackKind !== 'auto')
  const costUsd = decisions.reduce((s, d) => s + d.costUsd, 0)
  const fallbacks: Record<FallbackKind, number> = { model: 0, infra: 0, timeout: 0, auto: 0 }
  for (const d of decisions) if (d.fallbackKind) fallbacks[d.fallbackKind]++

  let preflopHands = 0
  let vpip = 0
  let pfr = 0
  let aggressive = 0
  let calls = 0
  let sawFlop = 0
  let showdowns = 0
  for (const h of seated) {
    const mine = h.decisions.filter((d) => d.playerId === playerId)
    const pre = mine.filter((d) => d.street === 'preflop')
    if (pre.length) preflopHands++ // a walk (no preflop decision) is not a chance to play
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
    costPerDecisionUsd: ratio(costUsd, answered.length),
    costPer100HandsUsd: seated.length ? (costUsd / seated.length) * 100 : null,
    meanInputTokens: mean(answered.map((d) => d.inputTokens)),
    meanOutputTokens: mean(answered.map((d) => d.outputTokens)),
    meanReasoningTokens: mean(answered.map((d) => d.reasoningTokens)),
    latencyP50Ms: quantile(answered.map((d) => d.latencyMs), 0.5),
    latencyP95Ms: quantile(answered.map((d) => d.latencyMs), 0.95),
    latencyMeanMs: mean(answered.map((d) => d.latencyMs)),
    fallbacks,
    fallbackRate: ratio(decisions.filter((d) => d.fallback).length, decisions.length),
    modelFallbackRate: ratio(fallbacks.model, decisions.length),
    retryRate: ratio(decisions.filter((d) => d.retries > 0).length, decisions.length),
    style: { vpip: ratio(vpip, preflopHands), pfr: ratio(pfr, preflopHands), af: ratio(aggressive, calls), wtsd: ratio(showdowns, sawFlop) },
  }
}
