import type { HandRecord } from '@ab/analysis'
import { buildView, EventStore, type GameEvent, type PlayerInfo } from '@ab/core'
import { describe, expect, it } from 'vitest'
import { Hub, type FeedMessage } from '../src/hub'
import { highlightReel, highlightScore, playReplay, replayDelay, replayQueue } from '../src/replay'
import { playLiveGame } from './fixtures'

function hand(over: Partial<HandRecord>): HandRecord {
  return { handId: 'h', bigBlind: 100, seats: [], holes: {}, board: [], decisions: [], folded: [], sawFlop: [], showdown: [], mainPotWinners: [], net: {}, ...over }
}
const said = (playerId: string, winProbability: number, optionId = 'call') =>
  ({ playerId, winProbability, optionId, fallback: false }) as unknown as HandRecord['decisions'][number]

describe('highlights', () => {
  const kinds = new Map<string, PlayerInfo>([
    ['jev', { id: 'jev', kind: 'jev', model: 'jev-1' }],
    ['pill', { id: 'pill', kind: 'llm', model: 'x/y' }],
    ['drip', { id: 'drip', kind: 'llm', model: 'x/z' }],
  ])

  it('scores chips won, all-ins, and Jev and an LLM both claiming the pot', () => {
    expect(highlightScore(hand({ net: { a: 500, b: -500 } }), kinds)).toBe(5)
    expect(highlightScore(hand({ net: { a: 500, b: -500 }, decisions: [said('pill', 0.5, 'all_in')] }), kinds)).toBe(30)
    // Jev says 80%, pill says 70%: 50 points over 100% between them (their last statements count).
    const clash = hand({ decisions: [said('jev', 0.3), said('pill', 0.7), said('jev', 0.8), said('drip', 0.1)] })
    expect(highlightScore(clash, kinds)).toBeCloseTo(50, 9)
    // Two LLMs disagreeing, or a coherent pair, add nothing.
    expect(highlightScore(hand({ decisions: [said('pill', 0.9), said('drip', 0.9)] }), kinds)).toBe(0)
    expect(highlightScore(hand({ decisions: [said('jev', 0.4), said('pill', 0.5)] }), kinds)).toBe(0)
  })

  it('makes a reel of the best hands of a game, in play order, after its game_started', async () => {
    const events = await playLiveGame(new EventStore(), 'g', 10)
    const reel = highlightReel(events, 3, 'best of g')!
    expect(reel.title).toBe('best of g')
    expect(reel.events[0]!.type).toBe('game_started')
    const starts = reel.events.filter((e) => e.type === 'hand_started').map((e) => (e as { handId: string }).handId)
    expect(starts).toHaveLength(3)
    expect([...starts].sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]))).toEqual(starts)
    expect(highlightReel([], 3, 'x')).toBeNull()
  })

  it('keeps each hand of a reel together even when the log interleaves hands (parallel study tables)', async () => {
    const a = await playLiveGame(new EventStore(), 'g', 4)
    const started = a[0]!
    const hands = new Map<string, GameEvent[]>()
    for (const e of a.slice(1)) {
      if (!('handId' in e) || e.handId === null) continue
      hands.set(e.handId, [...(hands.get(e.handId) ?? []), e])
    }
    // Interleave the hands' events round-robin, as parallel tables would log them.
    const lists = [...hands.values()]
    const mixed: GameEvent[] = [started]
    for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) mixed.push(l[i]!)
    const reel = highlightReel(mixed, 3, 'reel')!
    const order = reel.events.slice(1).map((e) => (e as { handId: string }).handId)
    const runs = order.filter((id, i) => i === 0 || id !== order[i - 1])
    expect(runs).toHaveLength(3) // three hands, each in one unbroken run
    expect(new Set(runs).size).toBe(3)
    expect(buildView(reel.events).handsPlayed).toBe(3) // and the reducer can follow it
  })

  it('alternates finished live games (newest first) with study reels, and skips unfinished games', async () => {
    const store = new EventStore()
    await playLiveGame(store, 'old', 3)
    await playLiveGame(store, 'new', 3)
    store.db.prepare("UPDATE games SET created_at = 1 WHERE id = 'old'").run()
    store.createGame('broken', 'live', {})
    store.setStatus('broken', 'interrupted')
    const study = await playLiveGame(new EventStore(), 'study-src', 4)
    store.createGame('st', 'study', {})
    for (const { gameId: _g, seq: _s, ts: _t, ...body } of study) store.append('st', body as never)
    store.setStatus('st', 'ended')
    store.createGame('resumable', 'study', {})
    store.setStatus('resumable', 'interrupted') // a stopped study can still resume: not replayed
    const cache = new Map()
    const queue = replayQueue(store, {}, cache)
    expect(queue.map((q) => q.title)).toEqual(['REPLAY · live game new', 'REPLAY · study st highlights', 'REPLAY · live game old'])
    expect(queue[1]!.events.every((e) => e.gameId === 'st')).toBe(true)
    // A stopped live game is over for good, so it is replayed too; built games come from the cache.
    await playLiveGame(store, 'stopped', 2)
    store.setStatus('stopped', 'interrupted')
    store.db.prepare("UPDATE games SET created_at = 0 WHERE id = 'stopped'").run()
    let reads = 0
    const events = store.events.bind(store)
    store.events = (...args: Parameters<typeof store.events>) => (reads++, events(...args))
    const again = replayQueue(store, {}, cache)
    expect(again.map((q) => q.gameId)).toEqual(['new', 'st', 'old', 'stopped'])
    expect(reads).toBe(1) // only the new game's log was read
  })
})

describe('playReplay', () => {
  it('plays every event at spectator pace on a replay channel', async () => {
    const events = await playLiveGame(new EventStore(), 'g', 2)
    const hub = new Hub()
    const got: FeedMessage[] = []
    hub.subscribe((m) => got.push(m))
    const waits: number[] = []
    const done = await playReplay(hub, { title: 'REPLAY · g', gameId: 'g', events }, { paceMs: 100, sleep: async (ms) => void waits.push(ms) })
    expect(done).toBe(true)
    expect(got[1]).toMatchObject({ type: 'snapshot', channel: { mode: 'replay', title: 'REPLAY · g', gameId: 'g' } })
    expect(got.filter((m) => m.type === 'event').map((m) => (m as { event: GameEvent }).event)).toEqual(events)
    expect(waits).toEqual(events.map((e) => replayDelay(e, 100)).filter((ms) => ms > 0))
    expect(replayDelay(events.find((e) => e.type === 'decision')!, 100)).toBe(100)
  })

  it('stops as soon as it is interrupted', async () => {
    const events = await playLiveGame(new EventStore(), 'g', 3)
    const hub = new Hub()
    let published = 0
    hub.subscribe((m) => void (m.type === 'event' && published++))
    const ac = new AbortController()
    let decisions = 0
    const done = await playReplay(hub, { title: 't', gameId: 'g', events }, {
      paceMs: 10,
      signal: ac.signal,
      sleep: async () => {
        if (++decisions === 5) ac.abort()
      },
    })
    expect(done).toBe(false)
    expect(published).toBeLessThan(events.length)
  })
})
