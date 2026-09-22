/**
 * pnpm study prereg <config.json> [--mock]                   print the pre-registration record and hash
 * pnpm study run    <config.json> (--mock | --live)          run or resume a study; --live spends real money
 * pnpm study status <config.json> [--mock]                   progress, cost and current bb/100 intervals
 * pnpm study report <config.json> [--mock] [--out dir]       write the HTML report and CSV/JSON exports (free)
 * Options: --db <path> (default data/studies.db); --takeover resumes a study a crash left marked
 * running (only if no other run of it is active). Keys come from .env (see .env.example).
 * Exit codes: 0 finished (or prereg/status/report), 1 error, 2 usage, 3 stopped early (budget cap or
 * interrupted: resume by running again).
 */
import { EventStore } from '@ab/core'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadStudyConfig, parseCliArgs, preregCommand, reportCommand, runCommand, statusCommand, USAGE, type CliArgs } from './commands'

let args: CliArgs
try {
  args = parseCliArgs(process.argv.slice(2))
} catch (e) {
  console.error(`${(e as Error).message}\n${USAGE}`)
  process.exit(2)
}
try {
  process.loadEnvFile('.env')
} catch (e) {
  // No .env is fine for --mock and status; a broken one is not.
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
}

const deps = { env: process.env, log: (line: string) => console.log(line) }
let exitCode = 0
let store: EventStore | null = null
try {
  const config = loadStudyConfig(args.configPath)
  if (args.command === 'prereg') {
    await preregCommand(config, args.mock, deps)
  } else {
    mkdirSync(dirname(args.db), { recursive: true })
    store = new EventStore(args.db)
    if (args.command === 'status') {
      statusCommand(config, args.mock, store, deps)
    } else if (args.command === 'report') {
      reportCommand(config, args.mock, store, args.out ?? `reports/${config.id}${args.mock ? '-mock' : ''}`, deps)
    } else {
      const ac = new AbortController()
      process.on('SIGINT', () => {
        if (ac.signal.aborted) {
          console.log('quitting now; the study stays marked running: resume with --takeover')
          process.exit(130)
        }
        console.log('stopping after the hands in progress… (Ctrl-C again to quit now)')
        ac.abort()
      })
      const outcome = await runCommand(config, args.mock, store, { ...deps, signal: ac.signal, takeover: args.takeover })
      if (outcome.reason === 'budget_cap' || outcome.reason === 'interrupted') exitCode = 3
    }
  }
} catch (e) {
  console.error(`error: ${(e as Error).message}`)
  exitCode = 1
} finally {
  store?.close()
}
process.exit(exitCode)
