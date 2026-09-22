import { extractHands, playerInfo, type HandRecord } from '@ab/analysis'
import type { EventStore, GameEvent, PlayerInfo } from '@ab/core'
import type { Hub } from './hub'
import { publicEvent } from './public'
import { sleep as realSleep, type Sleep } from './sleep'

/** One programme for the idle screen: a whole past live game, or a reel of study highlights. */
export interface ReplayItem {
  title: string
  gameId: string
  events: GameEvent[]
}

/**
 * How watchable a hand is: the chips won (in big blinds), a bonus for an all-in, and a bonus for a
 * Jev-vs-LLM disagreement: Jev and an LLM both in the hand whose last stated chances of winning it add
 * up to more than 100% (they can't both win, so at least one is badly wrong).
 */
export function highlightScore(hand: HandRecord, players: Map<string, PlayerInfo>): number {
  const wonBb = Object.values(hand.net).reduce((sum, n) => sum + Math.max(0, n), 0) / hand.bigBlind
  const allIn = hand.decisions.some((d) => d.optionId === 'all_in') ? 25 : 0
  const lastSaid = new Map<string, number>()
  for (const d of hand.decisions) if (d.winProbability !== null && !d.fallback) lastSaid.set(d.playerId, d.winProbability)
  let clash = 0
  for (const [jev, pj] of lastSaid) {
    if (players.get(jev)?.kind !== 'jev') continue
    for (const [llm, pl] of lastSaid) if (players.get(llm)?.kind === 'llm') clash = Math.max(clash, pj + pl - 1)
  }
  return wonBb + allIn + 100 * clash
}

/**
 * The `limit` most watchable hands of a game as one replay: game_started, then each hand's events in
 * full, hand after hand, in the order the hands started.
 */
export function highlightReel(events: readonly GameEvent[], limit: number, title: string): ReplayItem | null {
  const started = events.find((e) => e.type === 'game_started')
  if (!started) return null
  const info = playerInfo(events)
  const best = extractHands(events)
    .map((h) => ({ id: h.handId, score: highlightScore(h, info) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  if (best.length === 0) return null
  const keep = new Set(best.map((b) => b.id))
  // One hand after another: a study with parallel tables logs several hands' events interleaved.
  const byHand = new Map<string, GameEvent[]>()
  for (const e of events) {
    if (!('handId' in e) || e.handId === null || !keep.has(e.handId)) continue
    const list = byHand.get(e.handId)
    if (list) list.push(e)
    else byHand.set(e.handId, [e])
  }
  return { title, gameId: started.gameId, events: [started, ...[...byHand.values()].flat()] }
}

/**
 * What to show when no live game is on: the latest past live games (whole) alternating with highlight
 * reels of finished studies. Only finished games are replayed (their seeds may be public by then).
 */
export function replayQueue(store: EventStore, opts: { liveGames?: number; studies?: number; handsPerReel?: number } = {}): ReplayItem[] {
  const newestFirst = <T extends { createdAt: number }>(rows: T[]) => [...rows].sort((a, b) => b.createdAt - a.createdAt)
  const live = newestFirst(store.games('live').filter((g) => g.status === 'ended'))
    .slice(0, opts.liveGames ?? 5)
    .map((g): ReplayItem => ({ title: `REPLAY · live game ${g.id}`, gameId: g.id, events: store.events(g.id) }))
    .filter((item) => item.events.some((e) => e.type === 'hand_ended'))
  const studies = newestFirst(store.games('study').filter((g) => g.status === 'ended'))
    .slice(0, opts.studies ?? 3)
    .map((g) => highlightReel(store.events(g.id), opts.handsPerReel ?? 8, `REPLAY · study ${g.id} highlights`))
    .filter((item): item is ReplayItem => item !== null)
  const queue: ReplayItem[] = []
  for (let i = 0; i < Math.max(live.length, studies.length); i++) {
    if (live[i]) queue.push(live[i]!)
    if (studies[i]) queue.push(studies[i]!)
  }
  return queue
}

/** Pause after an event when replaying, relative to the per-action pace. */
export function replayDelay(e: GameEvent, paceMs: number): number {
  switch (e.type) {
    case 'decision':
      return paceMs
    case 'street_dealt':
      return paceMs / 2
    case 'hand_ended':
      return paceMs * 2
    case 'game_ended':
      return paceMs * 4
    default:
      return 0
  }
}

/** Plays a replay into the hub at spectator pace; stops early (returning false) when `signal` aborts. */
export async function playReplay(hub: Hub, item: ReplayItem, opts: { paceMs: number; signal?: AbortSignal; sleep?: Sleep }): Promise<boolean> {
  const wait = opts.sleep ?? realSleep
  hub.begin({ mode: 'replay', title: item.title, gameId: item.gameId })
  for (const e of item.events) {
    if (opts.signal?.aborted) return false
    hub.publish(publicEvent(e, true)) // only finished games are replayed
    const ms = replayDelay(e, opts.paceMs)
    if (ms > 0) await wait(ms, opts.signal)
  }
  return !opts.signal?.aborted
}
