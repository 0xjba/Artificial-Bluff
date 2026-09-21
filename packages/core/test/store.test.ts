import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DecisionEvent } from '../src/events'
import { canonicalJson, configHash, EventStore, SCHEMA_VERSION } from '../src/store'

const decision = (over: Partial<DecisionEvent> = {}): DecisionEvent => ({
  type: 'decision', handId: 'hand-0', street: 'preflop', playerId: 'jev', position: 'BTN', model: 'jev-1.13.0',
  optionId: 'call', label: 'Call 100', action: { type: 'call' }, chipsIn: 100, pot: 150, currentBet: 100, toCall: 100,
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
    const e1 = store.append('g1', { type: 'game_started', kind: 'live', players: [], configHash: 'x' }, 2000)
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
    const path = join(mkdtempSync(join(tmpdir(), 'ab-')), 'events.db')
    const a = new EventStore(path)
    a.createGame('g', 'study', { x: 1 })
    a.append('g', { type: 'game_started', kind: 'study', players: [], configHash: 'x' })
    a.close()
    const b = new EventStore(path)
    expect(b.events('g')).toHaveLength(1)
    b.close()
  })

  it('only accepts values JSON represents faithfully', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'], skip: undefined })).toBe('{"a":[true,null,"x"],"b":1}')
    for (const bad of [{ n: Number.NaN }, { n: Infinity }, { d: new Date(0) }, { m: new Map() }, { f: () => 1 }, { a: [1, undefined] }, { b: 10n }]) {
      expect(() => canonicalJson(bad)).toThrow(/canonicalJson/)
    }
  })

  it('rejects a bad config or event before writing anything', () => {
    const store = new EventStore()
    expect(() => store.createGame('g', 'live', { f: () => 1 })).toThrow(/function/)
    expect(store.games()).toEqual([])
    store.createGame('g', 'live', {})
    expect(() => store.append('g', decision({ latencyMs: Infinity }))).toThrow(/finite/)
    expect(store.events('g')).toEqual([])
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM decisions').get()).toEqual({ n: 0 })
  })

  it('refuses to update an unknown game and stamps the schema version', () => {
    const store = new EventStore()
    expect(() => store.setStatus('nope', 'ended')).toThrow(/no game nope/)
    expect(store.db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
  })

  it('refuses a database from newer code', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ab-')), 'events.db')
    const a = new EventStore(path)
    a.db.pragma(`user_version = ${SCHEMA_VERSION + 1}`)
    a.close()
    expect(() => new EventStore(path)).toThrow(/newer than this code/)
  })

  it('does not lose events when several processes write to one file', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ab-')), 'events.db')
    const setup = new EventStore(path)
    for (const g of ['a', 'b', 'c']) setup.createGame(g, 'study', {})
    setup.close()
    const here = dirname(fileURLToPath(import.meta.url))
    const tsx = join(here, '../../../node_modules/.bin/tsx')
    const writer = join(here, 'fixtures/concurrent-writer.ts')
    const run = (gameId: string) =>
      new Promise<number>((resolve) => {
        const child = spawn(tsx, [writer, path, gameId, '400'], { stdio: 'ignore' })
        child.on('exit', (code) => resolve(code ?? 1))
      })
    // Two writers on game a (contending for seq) and one each on b and c.
    expect(await Promise.all([run('a'), run('a'), run('b'), run('c')])).toEqual([0, 0, 0, 0])
    const store = new EventStore(path)
    const counts = store.db.prepare('SELECT game_id AS g, COUNT(*) AS n, MAX(seq) AS max FROM events GROUP BY game_id ORDER BY game_id').all()
    expect(counts).toEqual([
      { g: 'a', n: 800, max: 800 },
      { g: 'b', n: 400, max: 400 },
      { g: 'c', n: 400, max: 400 },
    ])
    store.close()
  }, 60_000)
})
