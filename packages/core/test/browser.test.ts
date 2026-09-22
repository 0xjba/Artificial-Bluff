import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { buildView } from '../src/view'
import { liveTurboConfig } from '@ab/engine'
import { CallingStation, MockLlm, TagBot } from '@ab/players'
import { describe, expect, it } from 'vitest'
import { equityKey, MemoryStore, runTournamentGame, tableEquity } from '../src/browser'

/** Files reachable from `entry` through relative imports (type-only imports skipped: they vanish when compiled). */
function reachable(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen
  seen.add(entry)
  const source = readFileSync(entry, 'utf8')
  for (const m of source.matchAll(/^import\s+(type\s+)?[^'"]*from\s+'(\.[^']+)'/gm)) {
    if (m[1]) continue
    reachable(resolve(dirname(entry), `${m[2]}.ts`), seen)
  }
  for (const m of source.matchAll(/^export\s+(type\s+)?[^'"]*from\s+'(\.[^']+)'/gm)) {
    if (m[1]) continue
    reachable(resolve(dirname(entry), `${m[2]}.ts`), seen)
  }
  return seen
}

describe('browser entry (@ab/core/browser)', () => {
  it('never reaches the SQLite store or Node built-ins', () => {
    const files = [...reachable(join(__dirname, '../src/browser.ts'))]
    expect(files.some((f) => f.endsWith('/store.ts'))).toBe(false)
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/from 'node:|from 'better-sqlite3'/)
  })

  it('plays a whole tournament into a MemoryStore', async () => {
    const store = new MemoryStore()
    const seen: number[] = []
    const players = [new MockLlm('jev'), new TagBot('pill'), new MockLlm('block'), new CallingStation('drip'), new MockLlm('nimbus')]
    const t = await runTournamentGame({ gameId: 'g', players, tournament: { ...liveTurboConfig('mem'), maxHands: 30 }, store, decisionTimeoutMs: 1000, budgetUsd: 100, onEvent: (e) => seen.push(e.seq) })
    const events = store.events('g')
    expect(events.map((e) => e.seq)).toEqual(seen)
    expect(events[0]).toMatchObject({ type: 'game_started', configHash: 'in-memory' })
    expect(events.at(-1)).toMatchObject({ type: 'game_ended', handsPlayed: t.handNumber })
    expect(store.status('g')).toBe('ended')
    const cost = events.reduce((c, e) => c + (e.type === 'decision' ? e.costUsd : 0), 0)
    expect(store.gameCost('g')).toBeCloseTo(cost, 12)
    expect(cost).toBeGreaterThan(0) // mock LLMs report a small cost
    expect(() => store.createGame('g', 'live', {})).toThrow(/exists/)
  })

  it('computes on-screen equity (moved from the server)', async () => {
    const store = new MemoryStore()
    const players = [new MockLlm('a'), new CallingStation('b'), new CallingStation('c')]
    await runTournamentGame({ gameId: 'g', players, tournament: { ...liveTurboConfig('eq'), maxHands: 2 }, store, decisionTimeoutMs: 1000, budgetUsd: 100 })
    const events = store.events('g')
    const flop = events.findIndex((e) => e.type === 'street_dealt')
    const view = buildView(events.slice(0, flop + 1))
    const eq = tableEquity(view)!
    expect(eq.estimated).toBe(false)
    expect(Object.values(eq.equity).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    expect(equityKey(view)).toContain(view.hand!.board.join(''))
  })
})
