/**
 * The live server: one table, replays while idle, spectator feed, admin API.
 *   pnpm live --mock     free: mock players, no keys (the example line-up if lineups/live.json is missing)
 *   pnpm live            real players from LINEUP (default lineups/live.json); live games cost money,
 *                        capped by LIVE_BUDGET_USD per game, and only start when an admin asks.
 * Settings come from the environment (see .env.example).
 */
import { parseServerConfig } from './config'
import { prepareLivePlayers } from './players'
import { startApp } from './app'

try {
  process.loadEnvFile('.env')
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
}

const config = parseServerConfig(process.env, process.argv.slice(2))
const players = await prepareLivePlayers({ lineupPath: config.lineupPath, mock: config.mock, env: process.env })
const app = await startApp(config, players)
console.log(`artificialBluff server on ${app.url} (${config.mock ? 'MOCK: free' : `REAL players, live games capped at $${config.liveBudgetUsd}`})`)
console.log(`players: ${players.specs.map((s) => `${s.id}=${'model' in s ? s.model : s.kind}`).join(', ')}`)
console.log(config.adminToken ? 'admin API on: POST /api/admin/games with Authorization: Bearer $ADMIN_TOKEN' : 'admin API off (set ADMIN_TOKEN to start games)')

let firstSignalAt = 0
const shutdown = (signal: string) => {
  // Ctrl-C reaches this process twice (from the terminal and forwarded by tsx): a repeat within a
  // second is the same keypress, not a request to quit at once.
  if (firstSignalAt) {
    if (Date.now() - firstSignalAt < 1000) return
    console.log('quitting now')
    process.exit(130)
  }
  firstSignalAt = Date.now()
  console.log(`${signal}: stopping after the hand in progress… (again to quit now)`)
  app.close().then(
    () => process.exit(0),
    (e) => {
      console.error(e)
      process.exit(1)
    },
  )
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
