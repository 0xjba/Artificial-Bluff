/**
 * Free end-to-end demo: a full live turbo tournament with mock/bot players, written to SQLite.
 * Usage: pnpm demo [dbPath]
 */
import { liveTurboConfig } from '@ab/engine'
import { CallingStation, MockLlm, TagBot } from '@ab/players'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { runTournamentGame } from '../src/game'
import { EventStore } from '../src/store'

const dbPath = process.argv[2] ?? 'data/demo.db'
mkdirSync(dirname(dbPath), { recursive: true })
const store = new EventStore(dbPath)
const gameId = `demo-${Date.now()}`
const players = [new MockLlm('hex', 'mock/jev'), new TagBot('pill'), new MockLlm('block'), new CallingStation('drip'), new MockLlm('nimbus', 'mock/llm', { failEvery: 25 })]

const t = await runTournamentGame({ gameId, players, tournament: liveTurboConfig(gameId), store, decisionTimeoutMs: 2000, budgetUsd: 1 })
const events = store.events(gameId)
const decisions = events.filter((e) => e.type === 'decision')
console.log(`game ${gameId}: ${t.handNumber} hands, ${decisions.length} decisions, ${events.length} events -> ${dbPath}`)
console.log(`ended: ${t.endReason}, winner: ${t.winner}, eliminated: ${t.eliminated.join(', ') || 'none'}`)
const rows = store.db
  .prepare(
    `SELECT player_id AS player, model, COUNT(*) AS decisions, ROUND(AVG(latency_ms), 1) AS avg_ms,
            ROUND(SUM(cost_usd), 6) AS cost_usd, SUM(fallback) AS fallbacks
     FROM decisions WHERE game_id = ? GROUP BY player_id ORDER BY player_id`,
  )
  .all(gameId)
console.table(rows)
store.close()
