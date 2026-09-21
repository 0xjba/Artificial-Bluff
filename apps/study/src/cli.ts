/**
 * pnpm study prereg <config.json> [--mock]    print the pre-registration record and hash
 * pnpm study run    <config.json> [--mock]    run or resume a study (real runs spend money)
 * pnpm study status <config.json> [--mock]    progress, cost and current bb/100 intervals
 * Options: --db <path> (default data/studies.db); --takeover resumes a study a crash left marked
 * running (only if no other run of it is active). Keys come from .env (see .env.example).
 */
import { EventStore } from '@ab/core'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadStudyConfig, preregCommand, runCommand, statusCommand } from './commands'

const [command, configPath, ...rest] = process.argv.slice(2)
const mock = rest.includes('--mock')
const takeover = rest.includes('--takeover')
const dbIndex = rest.indexOf('--db')
const dbPath = dbIndex >= 0 ? rest[dbIndex + 1]! : 'data/studies.db'
if (!command || !configPath || !['prereg', 'run', 'status'].includes(command)) {
  console.error('usage: pnpm study <prereg|run|status> <config.json> [--mock] [--db path] [--takeover]')
  process.exit(2)
}
try {
  process.loadEnvFile('.env')
} catch {
  // no .env: fine for --mock and status
}
const config = loadStudyConfig(configPath)
const deps = { env: process.env, log: (line: string) => console.log(line) }

if (command === 'prereg') {
  await preregCommand(config, mock, deps)
} else {
  mkdirSync(dirname(dbPath), { recursive: true })
  const store = new EventStore(dbPath)
  if (command === 'status') {
    statusCommand(config, mock, store, deps)
  } else {
    const ac = new AbortController()
    process.once('SIGINT', () => {
      console.log('stopping after the hands in progress…')
      ac.abort()
    })
    await runCommand(config, mock, store, { ...deps, signal: ac.signal, takeover })
  }
  store.close()
}
