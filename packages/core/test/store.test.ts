import { describe, expect, it } from 'vitest'
import type { DecisionEvent } from '../src/events'
import { configHash, EventStore } from '../src/store'

const decision = (over: Partial<DecisionEvent> = {}): DecisionEvent => ({
  type: 'decision', handId: 'hand-0', street: 'preflop', playerId: 'jev', position: 'BTN', model: 'jev-1.13.0',
  optionId: 'call', label: 'Call 100', action: { type: 'call' }, chipsIn: 100, pot: 150, toCall: 100,
  winProbability: 0.5, confidence: 0.4, optionProbabilities: { call: 0.6, fold: 0.4 }, reasoning: null,
  latencyMs: 120, inputTokens: 500, outputTokens: 2, reasoningTokens: 0, costUsd: 0.000021, retries: 0,
  fallback: false, fallbackKind: null, fallbackReason: null,
  ...over,
})

describe('EventStore', () => {
  it('hashes configs canonically (key order does not matter)', () => {
    expect(configHash({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(configHash({ b: { d: [1, 2], c: 2 }, a: 1 }))
    expect(configHash({ a: 1 })).not.toBe(configHash({ a: 2 }))
  })

  it('records games and appends events in order with seq and ts', () => {
    const store = new EventStore()
    const game = store.createGame('g1', 'live', { z: 1, a: 2 }, 1000)
    expect(game).toMatchObject({ id: 'g1', kind: 'live', status: 'running', config: { a: 2, z: 1 }, createdAt: 1000 })
    const e1 = store.append('g1', { type: 'game_started', kind: 'live', players: [] }, 2000)
    const e2 = store.append('g1', decision(), 3000)
    expect([e1.seq, e2.seq]).toEqual([1, 2])
    expect(store.events('g1').map((e) => [e.seq, e.type, e.ts])).toEqual([
      [1, 'game_started', 2000],
      [2, 'decision', 3000],
    ])
    expect(store.events('g1', 1)).toHaveLength(1)
    expect(store.events('g1')[1]).toEqual({ ...decision(), gameId: 'g1', seq: 2, ts: 3000 })
  })

  it('denormalizes decisions and sums game cost', () => {
    const store = new EventStore()
    store.createGame('g1', 'live', {})
    store.append('g1', decision({ costUsd: 0.01 }))
    store.append('g1', decision({ costUsd: 0.02, playerId: 'pill', fallback: true, fallbackKind: 'timeout', fallbackReason: 'timeout' }))
    expect(store.gameCost('g1')).toBeCloseTo(0.03)
    const rows = store.db.prepare('SELECT player_id, fallback, fallback_kind, action_type FROM decisions ORDER BY seq').all()
    expect(rows).toEqual([
      { player_id: 'jev', fallback: 0, fallback_kind: null, action_type: 'call' },
      { player_id: 'pill', fallback: 1, fallback_kind: 'timeout', action_type: 'call' },
    ])
  })

  it('marks games left running as interrupted', () => {
    const store = new EventStore()
    store.createGame('a', 'live', {})
    store.createGame('b', 'live', {})
    store.setStatus('b', 'ended')
    expect(store.interruptRunningGames()).toEqual(['a'])
    expect(store.game('a')!.status).toBe('interrupted')
    expect(store.games('live').map((g) => g.id)).toEqual(['a', 'b'])
  })

  it('persists to a file', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const path = join(mkdtempSync(join(tmpdir(), 'ab-')), 'events.db')
    const a = new EventStore(path)
    a.createGame('g', 'study', { x: 1 })
    a.append('g', { type: 'game_started', kind: 'study', players: [] })
    a.close()
    const b = new EventStore(path)
    expect(b.events('g')).toHaveLength(1)
    b.close()
  })
})
