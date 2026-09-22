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
  /** Hands where the seat won or shared the main pot, of hands it was dealt into. */
  winRate: number | null
  /** Chips won across the games (chips are conserved, so these sum to 0). */
  chipsWon: number
  /** Every model that has played this seat, newest first. */
  models: string[]
  /** Chips won per 100 hands, in big blinds (comparable across stakes). */
  bb100: number | null
  decisions: number
  latencyMeanMs: number | null
  costUsd: number
  costPerDecisionUsd: number | null
  /**
   * Mean of (the win chance the model stated) minus (its true chance from every hole card), in
   * percentage points: how far it leans, and which way. Positive means it talks itself up. Over and
   * under-statements cancel here, so this is a bias, not an accuracy. Null when a seat states nothing.
   */
  biasPts: number | null
  /**
   * Mean of |stated − true|, in percentage points: how far a stated chance sits from the truth,
   * whichever way. This is the accuracy figure; nothing cancels.
   */
  errorPts: number | null
  /** Decisions those two figures are computed from. */
  statedDecisions: number
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
  /** Chips awarded in the hand (every pot), from the log's pot_awarded events. */
  pot: number
  /** Chips each winner took, by player id (from the log's shares, so a split adds up to the pot). */
  won: Record<string, number>
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
  /** Scored decisions (outcome C); empty when the game was summarised without scoring. */
  scored: ScoredDecision[]
  players: Map<string, PlayerInfo>
  /** Chips awarded per hand, and to whom, from the log's pot_awarded events. */
  pots: Map<string, { total: number; won: Record<string, number> }>
  starts: Map<string, { seq: number; ts: number }>
}

/** Analysed games, so a page view doesn't re-read and re-score the whole log. Oldest entries are dropped. */
export type SummaryCache = Map<string, GameAnalysis>

/** Games kept in the cache: each holds a game's hands and scored decisions. */
export const SUMMARY_CACHE_GAMES = 20
/**
 * Above this many hand evaluations for one deal and board, the true chance is estimated from 20,000
 * sampled boards instead of enumerated (the same rule as the live table's on-screen equity). A
 * five-handed preflop decision enumerates about 850,000 boards; the site would otherwise spend half a
 * minute of CPU per game and stall the spectator feed.
 */
export const SUMMARY_EXACT_LIMIT = 200_000

/** Chips awarded per hand, and to whom. */
function potsOf(events: readonly GameEvent[]): Map<string, { total: number; won: Record<string, number> }> {
  const pots = new Map<string, { total: number; won: Record<string, number> }>()
  for (const e of events) {
    if (e.type !== 'pot_awarded' || e.handId === null) continue
    const pot = pots.get(e.handId) ?? { total: 0, won: {} }
    pot.total += e.amount
    // The log records each winner's exact share (an odd chip goes to one of them).
    for (const [w, share] of Object.entries(e.shares)) pot.won[w] = (pot.won[w] ?? 0) + share
    pots.set(e.handId, pot)
  }
  return pots
}

function analyse(store: EventStore, gameId: string, cache: SummaryCache, { score = true } = {}): GameAnalysis | null {
  const cached = cache.get(gameId)
  if (cached && (!score || cached.scored.length > 0)) return cached
  const events = store.events(gameId)
  if (events.length === 0) return null
  const hands = extractHands(events)
  const starts = new Map<string, { seq: number; ts: number }>()
  for (const e of events) {
    if (e.type === 'hand_started' && e.handId !== null && !starts.has(e.handId)) starts.set(e.handId, { seq: e.seq, ts: e.ts })
  }
  const analysis: GameAnalysis = {
    hands,
    // Estimated rather than enumerated where enumeration is dear: this is a screen, not the study.
    scored: score ? scoreDecisions(hands, new Map(), { maxEvaluations: SUMMARY_EXACT_LIMIT, seedNamespace: 'summary' }) : [],
    players: playerInfo(events),
    pots: potsOf(events),
    starts,
  }
  cache.set(gameId, analysis)
  while (cache.size > SUMMARY_CACHE_GAMES) cache.delete(cache.keys().next().value!)
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
        models: [],
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
        biasPts: null,
        errorPts: null,
        statedDecisions: 0,
        fallbacks: 0,
        style: { vpip: null, pfr: null, af: null, wtsd: null },
      }
      seat.games++
      if (!seat.models.includes(p.model)) seat.models.push(p.model)
      seat.model = seat.models[0]!
      seats.set(p.id, seat)
    }
  }
  const scored = analyses.flatMap((a) => a.scored)
  for (const seat of seats.values()) {
    const seated = hands.filter((h) => h.seats.some((s) => s.playerId === seat.playerId))
    const metrics = playerMetrics(hands, seat.playerId)
    const said = scored.filter((d) => d.playerId === seat.playerId && d.winProbability !== null && !d.fallback)
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
    seat.statedDecisions = said.length
    seat.biasPts = said.length ? (said.reduce((sum, d) => sum + (d.winProbability! - d.expectedShare), 0) / said.length) * 100 : null
    seat.errorPts = said.length ? (said.reduce((sum, d) => sum + Math.abs(d.winProbability! - d.expectedShare), 0) / said.length) * 100 : null
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
  const many = h.winners.length > 1
  if (h.busted.length) return `${winners} ${many ? 'knock' : 'knocks'} out ${h.busted.map(name).join(' and ')} in a ${chips(h.pot)} pot`
  if (h.tags.includes('split')) return `${winners} split ${chips(h.pot)} between them`
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
export function handIndex(store: EventStore, gameId: string, cache: SummaryCache = new Map(), { score = true } = {}): HandSummary[] {
  const analysis = analyse(store, gameId, cache, { score })
  if (!analysis) return []
  const scoredByHand = new Map<string, ScoredDecision[]>()
  for (const d of analysis.scored) scoredByHand.set(d.handId, [...(scoredByHand.get(d.handId) ?? []), d])
  const kinds = new Map([...analysis.players].map(([id, p]) => [id, p.kind]))
  const potOf = (hand: HandRecord) => analysis.pots.get(hand.handId)?.total ?? 0
  // One hand carries the tag, even when two pots tie: the earliest of the biggest.
  const biggest = analysis.hands.reduce<HandRecord | null>((best, h) => (best === null || potOf(h) > potOf(best) ? h : best), null)

  const summaries = analysis.hands.map((hand, i): HandSummary => {
    const decisions = scoredByHand.get(hand.handId) ?? []
    const read = worstRead(decisions)
    const pot = analysis.pots.get(hand.handId)
    // A seat is out when it ends the hand with nothing (the live tournament has no rebuys).
    const busted = hand.seats.filter((s) => s.startStack + (hand.net[s.playerId] ?? 0) <= 0).map((s) => s.playerId)
    const tags: HandTag[] = []
    if (biggest === hand && potOf(hand) > 0) tags.push('biggest-pot')
    if (hand.showdown.length) tags.push('showdown')
    if (busted.length) tags.push('elimination')
    if (hand.mainPotWinners.length > 1) tags.push('split')
    if (hand.decisions.some((d) => d.fallback)) tags.push('timeout')
    if (hand.showdown.some((id) => kinds.get(id) === 'jev') && hand.showdown.some((id) => kinds.get(id) === 'llm')) tags.push('jev-vs-llm')
    if (read && read.gapPts >= WORST_READ_PTS) tags.push('worst-read')
    const start = analysis.starts.get(hand.handId)
    const summary: HandSummary = {
      gameId,
      handId: hand.handId,
      number: i + 1,
      ts: start?.ts ?? 0,
      pot: pot?.total ?? 0,
      won: pot?.won ?? {},
      bigBlind: hand.bigBlind,
      players: hand.seats.map((s) => s.playerId),
      winners: hand.mainPotWinners,
      shown: hand.showdown,
      busted,
      tags,
      headline: '',
      startSeq: start?.seq ?? 0,
    }
    summary.headline = headlineFor(summary, hand, read)
    return summary
  })
  return summaries.reverse()
}
