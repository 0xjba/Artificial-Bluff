import { extractHands, playerInfo, playerMetrics, scoreDecisions, type HandRecord, type PlayStyle, type ScoredDecision } from '@ab/analysis'
import type { EventStore, GameEvent, PlayerInfo } from '@ab/core'
import type { PlayerKind } from '@ab/players'
import { isOver } from './public'

/** One model's record across the games counted, as the Models page shows it. */
export interface SeatSummary {
  playerId: string
  kind: PlayerKind
  model: string
  games: number
  hands: number
  handsWon: number
  /** Hands won of hands dealt. */
  winRate: number | null
  /** Chips won across the games (chips are conserved, so these sum to 0). */
  chipsWon: number
  /** Chips won per 100 hands, in big blinds (comparable across stakes). */
  bb100: number | null
  decisions: number
  latencyMeanMs: number | null
  costUsd: number
  costPerDecisionUsd: number | null
  /**
   * Mean of (the win chance the model stated) minus (its true chance from every hole card), in
   * percentage points. Positive means it talked itself up. Null for seats that state nothing (Jev
   * answers with option probabilities instead).
   */
  honestyGapPts: number | null
  /** Decisions that fell back to check-or-fold (a timeout, an invalid answer, a provider error). */
  fallbacks: number
  style: PlayStyle
}

export interface ModelsTable {
  games: number
  hands: number
  /** Best first, by chips won. */
  seats: SeatSummary[]
}

/** One hand of a game, as the Replays page lists it. */
export interface HandSummary {
  gameId: string
  handId: string
  /** 1 for the game's first hand. */
  number: number
  ts: number
  pot: number
  bigBlind: number
  players: string[]
  winners: string[]
  /** Players whose cards were shown down. */
  shown: string[]
  /** Players knocked out in this hand. */
  busted: string[]
  tags: HandTag[]
  /** A plain description of what happened, from the log alone. */
  headline: string
  /** Where the hand starts in the game's events, for a replay that opens on it. */
  startSeq: number
}

export type HandTag = 'biggest-pot' | 'showdown' | 'elimination' | 'split' | 'timeout' | 'jev-vs-llm' | 'worst-read'

/** How far a stated win chance must be from the true one to call it a bad read (percentage points). */
export const WORST_READ_PTS = 30

const name = (id: string) => id.toUpperCase()
const chips = (n: number) => Math.round(n).toLocaleString('en-US')

interface GameAnalysis {
  hands: HandRecord[]
  scored: ScoredDecision[]
  players: Map<string, PlayerInfo>
  events: GameEvent[]
}

/** Analysed games, so a page view doesn't re-read and re-score the whole log. */
export type SummaryCache = Map<string, GameAnalysis>

function analyse(store: EventStore, gameId: string, cache: SummaryCache): GameAnalysis | null {
  const cached = cache.get(gameId)
  if (cached) return cached
  const events = store.events(gameId)
  if (events.length === 0) return null
  const hands = extractHands(events)
  const analysis: GameAnalysis = { hands, scored: scoreDecisions(hands), players: playerInfo(events), events }
  cache.set(gameId, analysis)
  return analysis
}

/** Finished live games, newest first (a running game is still changing, so it is left out). */
const finishedLiveGames = (store: EventStore) =>
  store
    .games('live')
    .filter(isOver)
    .sort((a, b) => b.createdAt - a.createdAt)

/**
 * What every model has done across the finished live games: chips, hands won, speed, spend, how far
 * its stated win chances sat from the true ones, and how it plays. Everything comes from the event
 * log; nothing here is entered by hand.
 */
export function modelsTable(store: EventStore, cache: SummaryCache = new Map()): ModelsTable {
  const games = finishedLiveGames(store)
  const analyses = games.map((g) => analyse(store, g.id, cache)).filter((a) => a !== null)
  const hands = analyses.flatMap((a) => a.hands)
  const seats = new Map<string, SeatSummary>()
  for (const a of analyses) {
    for (const p of a.players.values()) {
      const seat = seats.get(p.id) ?? {
        playerId: p.id,
        kind: p.kind,
        model: p.model,
        games: 0,
        hands: 0,
        handsWon: 0,
        winRate: null,
        chipsWon: 0,
        bb100: null,
        decisions: 0,
        latencyMeanMs: null,
        costUsd: 0,
        costPerDecisionUsd: null,
        honestyGapPts: null,
        fallbacks: 0,
        style: { vpip: null, pfr: null, af: null, wtsd: null },
      }
      seat.games++
      seats.set(p.id, seat)
    }
  }
  for (const seat of seats.values()) {
    const seated = hands.filter((h) => h.seats.some((s) => s.playerId === seat.playerId))
    const metrics = playerMetrics(hands, seat.playerId)
    const said = analyses
      .flatMap((a) => a.scored)
      .filter((d) => d.playerId === seat.playerId && d.winProbability !== null && !d.fallback)
    seat.hands = seated.length
    seat.handsWon = seated.filter((h) => h.mainPotWinners.includes(seat.playerId)).length
    seat.winRate = seat.hands ? seat.handsWon / seat.hands : null
    seat.chipsWon = seated.reduce((sum, h) => sum + (h.net[seat.playerId] ?? 0), 0)
    const bb = seated.reduce((sum, h) => sum + (h.net[seat.playerId] ?? 0) / h.bigBlind, 0)
    seat.bb100 = seat.hands ? (bb / seat.hands) * 100 : null
    seat.decisions = metrics.decisions
    seat.latencyMeanMs = metrics.latencyMeanMs
    seat.costUsd = metrics.costUsd
    seat.costPerDecisionUsd = metrics.costPerDecisionUsd
    seat.fallbacks = Object.values(metrics.fallbacks).reduce((sum, n) => sum + n, 0)
    seat.style = metrics.style
    seat.honestyGapPts = said.length ? (said.reduce((sum, d) => sum + (d.winProbability! - d.expectedShare), 0) / said.length) * 100 : null
  }
  return {
    games: analyses.length,
    hands: hands.length,
    seats: [...seats.values()].sort((a, b) => b.chipsWon - a.chipsWon),
  }
}

/** The biggest gap between a stated win chance and the true one in a hand, in percentage points. */
function worstRead(decisions: ScoredDecision[]): { playerId: string; saidPts: number; truePts: number; gapPts: number } | null {
  let worst: { playerId: string; saidPts: number; truePts: number; gapPts: number } | null = null
  for (const d of decisions) {
    if (d.winProbability === null || d.fallback) continue
    const gapPts = Math.abs(d.winProbability - d.expectedShare) * 100
    if (!worst || gapPts > worst.gapPts) worst = { playerId: d.playerId, saidPts: d.winProbability * 100, truePts: d.expectedShare * 100, gapPts }
  }
  return worst
}

/** What to call a hand, from what actually happened in it. */
function headlineFor(h: HandSummary, hand: HandRecord, read: ReturnType<typeof worstRead>): string {
  const winners = h.winners.map(name).join(' and ')
  if (h.busted.length) return `${winners} knocks out ${h.busted.map(name).join(' and ')} in a ${chips(h.pot)} pot`
  if (h.tags.includes('split')) return `${winners} split ${chips(h.pot)}`
  if (h.tags.includes('worst-read') && read) {
    return `${name(read.playerId)} said ${Math.round(read.saidPts)}% with ${Math.round(read.truePts)}% to win`
  }
  if (h.tags.includes('biggest-pot')) return `${winners} wins the biggest pot of the game: ${chips(h.pot)}`
  const shown = hand.showdown.length ? ` at a ${hand.showdown.length}-way showdown` : ' after everyone else folded'
  return `${winners} wins ${chips(h.pot)}${shown}`
}

/**
 * Every hand of a game, newest first, with tags and a headline worked out from the log: the biggest
 * pot, knock-outs, showdowns, split pots, seats that timed out, hands Jev and an LLM both saw to the
 * end, and the widest gap between a stated win chance and the true one.
 */
export function handIndex(store: EventStore, gameId: string, cache: SummaryCache = new Map()): HandSummary[] {
  const analysis = analyse(store, gameId, cache)
  if (!analysis) return []
  const startSeq = new Map<string, number>()
  const ts = new Map<string, number>()
  for (const e of analysis.events) {
    if (e.type !== 'hand_started' || e.handId === null || startSeq.has(e.handId)) continue
    startSeq.set(e.handId, e.seq)
    ts.set(e.handId, e.ts)
  }
  const scoredByHand = new Map<string, ScoredDecision[]>()
  for (const d of analysis.scored) scoredByHand.set(d.handId, [...(scoredByHand.get(d.handId) ?? []), d])

  const biggestPot = Math.max(0, ...analysis.hands.map((h) => Object.values(h.net).reduce((sum, n) => sum + Math.max(0, n), 0)))
  const summaries = analysis.hands.map((hand, i): HandSummary => {
    const decisions = scoredByHand.get(hand.handId) ?? []
    const read = worstRead(decisions)
    const pot = Object.values(hand.net).reduce((sum, n) => sum + Math.max(0, n), 0)
    const busted = hand.seats.filter((s) => s.startStack + (hand.net[s.playerId] ?? 0) <= 0).map((s) => s.playerId)
    const kinds = new Map([...analysis.players].map(([id, p]) => [id, p.kind]))
    const tags: HandTag[] = []
    if (pot > 0 && pot === biggestPot) tags.push('biggest-pot')
    if (hand.showdown.length) tags.push('showdown')
    if (busted.length) tags.push('elimination')
    if (hand.mainPotWinners.length > 1) tags.push('split')
    if (decisions.some((d) => d.fallback)) tags.push('timeout')
    if (hand.showdown.some((id) => kinds.get(id) === 'jev') && hand.showdown.some((id) => kinds.get(id) === 'llm')) tags.push('jev-vs-llm')
    if (read && read.gapPts >= WORST_READ_PTS) tags.push('worst-read')
    const summary: HandSummary = {
      gameId,
      handId: hand.handId,
      number: i + 1,
      ts: ts.get(hand.handId) ?? 0,
      pot,
      bigBlind: hand.bigBlind,
      players: hand.seats.map((s) => s.playerId),
      winners: hand.mainPotWinners,
      shown: hand.showdown,
      busted,
      tags,
      headline: '',
      startSeq: startSeq.get(hand.handId) ?? 0,
    }
    summary.headline = headlineFor(summary, hand, read)
    return summary
  })
  return summaries.reverse()
}
