/**
 * Real-API smoke test: a short live tournament with the players in a line-up file.
 * Costs real money (capped by --budget). Keys come from .env (see .env.example).
 * Usage: pnpm smoke [lineups/live.json] [--hands 5] [--budget 0.25]
 * Line-ups: copy lineups/live.example.json or lineups/research.example.json and edit.
 */
import { liveTurboConfig } from '@ab/engine'
import { adaptLineup, createPlayers, fetchModelCatalog, type PlayerSpec } from '@ab/players'
import { mkdirSync, readFileSync } from 'node:fs'
import { runTournamentGame } from '../src/game'
import { EventStore } from '../src/store'

const args = process.argv.slice(2)
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? Number(args[i + 1]) : fallback
}
const lineupPath = args.find((a) => a.endsWith('.json')) ?? 'lineups/live.json'
const hands = flag('hands', 5)
const budgetUsd = flag('budget', 0.25)

const lineup = JSON.parse(readFileSync(lineupPath, 'utf8')) as { players: PlayerSpec[] }
// Free pre-flight: check models exist and set request flags from what each supports.
const { specs, problems } = adaptLineup(lineup.players, await fetchModelCatalog())
for (const p of problems) console.warn(`preflight: ${p}`)
if (problems.some((p) => p.includes('not in the OpenRouter catalog'))) process.exit(1)
const players = createPlayers(specs, process.env)
mkdirSync('data', { recursive: true })
const store = new EventStore('data/smoke.db')
const gameId = `smoke-${Date.now()}`
console.log(`smoke ${gameId}: ${players.map((p) => `${p.id}=${p.model}`).join(', ')}; ${hands} hands max, $${budgetUsd} cap`)

const t = await runTournamentGame({
  gameId,
  players,
  tournament: { ...liveTurboConfig(gameId), maxHands: hands },
  store,
  decisionTimeoutMs: 20_000,
  budgetUsd,
  meta: { lineup: specs },
})
for (const e of store.events(gameId)) {
  if (e.type !== 'decision') continue
  const why = e.fallback ? `FALLBACK (${e.fallbackReason})` : (e.reasoning ?? '')
  console.log(
    `${e.handId} ${e.street.padEnd(7)} ${e.playerId.padEnd(7)} ${e.label.padEnd(18)} ${String(Math.round(e.latencyMs)).padStart(6)}ms $${e.costUsd.toFixed(5)} win=${e.winProbability ?? '-'} ${why}`,
  )
}
console.log(`ended: ${t.endReason} after ${t.handNumber} hands; total cost $${store.gameCost(gameId).toFixed(4)}`)
store.close()
