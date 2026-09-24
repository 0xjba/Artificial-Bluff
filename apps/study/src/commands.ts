import { configHash, EventStore } from '@ab/core'
import { adaptLineup, createPlayers, fetchModelCatalog, type PlayerEnv, type PlayerSpec } from '@ab/players'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseStudyConfig, type StudyConfig } from './config'
import { assertPreregMatches, preregistration } from './prereg'
import { readStoreProgress } from './progress'
import { summarize, type StudySummary } from './results'
import { decisionsCsv, eventsJsonl, handsCsv } from './exports'
import { renderReportHtml } from './html'
import { renderPaperHtml } from './paper'
import { printPdf } from './pdf'
import { analyseStudy, analysedGroupCount, focusPlayer } from './report'
import { runStudy, type StudyOutcome } from './run'

export function loadStudyConfig(path: string): StudyConfig {
  return parseStudyConfig(JSON.parse(readFileSync(path, 'utf8')))
}

/** A free dry run: every paid seat becomes a mock, under a separate study id so data never mixes. */
export function mockVariant(config: StudyConfig): StudyConfig {
  // Jev seats keep the real player, answered offline, so a rehearsal runs its request and move code.
  const lineup: PlayerSpec[] = config.lineup.map((s) =>
    s.kind === 'jev'
      ? { id: s.id, kind: 'jev', model: `mock/${s.model}`, ...(s.mode ? { mode: s.mode } : {}), offline: true }
      : s.kind === 'llm'
        ? { id: s.id, kind: 'mock', model: `mock/${s.model}` }
        : s,
  )
  return { ...config, id: `${config.id}-mock`, lineup }
}

/** Line-up with request flags filled from the model catalog (real runs), or as-is (mock runs). */
export async function resolveLineup(config: StudyConfig, mock: boolean, log: (line: string) => void): Promise<PlayerSpec[]> {
  if (mock) return config.lineup
  const { specs, problems } = adaptLineup(config.lineup, await fetchModelCatalog())
  for (const p of problems) log(`preflight: ${p}`)
  if (problems.some((p) => p.includes('not in the OpenRouter catalog'))) throw new Error('preflight failed: unknown model(s)')
  return specs
}

export function formatSummary(summary: StudySummary, costUsd: number): string[] {
  const lines = [`${summary.groups} groups (${summary.blocks} blocks), $${costUsd.toFixed(4)} spent`]
  for (const p of summary.players) {
    const half = Number.isFinite(p.bb100.halfWidth) ? `± ${p.bb100.halfWidth.toFixed(1)}` : '± ∞'
    const mean = Number.isFinite(p.bb100.mean) ? p.bb100.mean.toFixed(1) : 'n/a'
    lines.push(`  ${p.playerId.padEnd(8)} ${mean.padStart(8)} bb/100 ${half}`)
  }
  return lines
}

export interface CommandDeps {
  env: PlayerEnv
  log: (line: string) => void
  signal?: AbortSignal
  /** Resume a study a crash left marked 'running' (never while another process runs it). */
  takeover?: boolean
}

/** Prints the pre-registration record and its hash without running anything. */
export async function preregCommand(config: StudyConfig, mock: boolean, deps: CommandDeps): Promise<string> {
  const c = mock ? mockVariant(config) : config
  const record = preregistration(c, await resolveLineup(c, mock, deps.log))
  deps.log(JSON.stringify(record, null, 2))
  const hash = configHash(record)
  deps.log(`pre-registration hash: ${hash}`)
  return hash
}

export async function runCommand(config: StudyConfig, mock: boolean, store: EventStore, deps: CommandDeps): Promise<StudyOutcome> {
  const c = mock ? mockVariant(config) : config
  const game = store.game(c.id)
  let lineup: PlayerSpec[]
  if (game) {
    // Resume with the pre-registered line-up: re-adapting it to today's model catalog could change
    // its request flags, and so the hash, and lock the study out.
    const record = game.config as Record<string, unknown>
    assertPreregMatches(record, c)
    lineup = (record.study as { lineup: PlayerSpec[] }).lineup
    const progress = readStoreProgress(store, c.id)
    if (progress.lastEnd === 'ci_target' || progress.lastEnd === 'max_groups') deps.log(`study ${c.id} already finished (${progress.lastEnd})`)
    const spent = store.gameCost(c.id)
    if (progress.lastEnd === 'budget_cap' && spent >= c.budgetUsd) {
      throw new Error(`study ${c.id}: budget already spent ($${spent.toFixed(4)} of $${c.budgetUsd}); raise budgetUsd to resume`)
    }
  } else {
    lineup = await resolveLineup(c, mock, deps.log)
  }
  const players = createPlayers(lineup, deps.env)
  const prereg = preregistration(c, lineup)
  if (mock) deps.log('mock mode: no API calls are made; costs shown are simulated')
  else deps.log(`REAL RUN: this spends real money, up to $${c.budgetUsd} for the whole study`)
  deps.log(`study ${c.id}: ${players.map((p) => `${p.id}=${p.model}`).join(', ')}`)
  deps.log(`pre-registration hash ${configHash(prereg)}; budget $${c.budgetUsd}; ${c.concurrency} table(s)`)
  if (c.concurrency > 1) deps.log(`note: up to ${c.concurrency} decisions already in flight can finish after the budget is reached`)
  const outcome = await runStudy({
    config: c,
    players,
    store,
    prereg,
    ...(deps.signal ? { signal: deps.signal } : {}),
    ...(deps.takeover ? { takeover: true } : {}),
    onCheckpoint: (summary, cost) => formatSummary(summary, cost).forEach(deps.log),
  })
  deps.log(`ended: ${outcome.reason}`)
  formatSummary(outcome.summary, outcome.costUsd).forEach(deps.log)
  return outcome
}

export function statusCommand(config: StudyConfig, mock: boolean, store: EventStore, deps: CommandDeps): void {
  const c = mock ? mockVariant(config) : config
  const game = store.game(c.id)
  if (!game) {
    deps.log(`study ${c.id} has not started`)
    return
  }
  assertPreregMatches(game.config as Record<string, unknown>, c)
  const progress = readStoreProgress(store, c.id)
  const groups = analysedGroupCount(progress, game.status, c)
  deps.log(`study ${c.id}: ${game.status}${progress.lastEnd ? ` (${progress.lastEnd})` : ''}, ${progress.handsPlayed} hands played, hash ${game.configHash.slice(0, 12)}…`)
  formatSummary(summarize(progress, c, groups), store.gameCost(c.id)).forEach(deps.log)
}

/**
 * Writes the study report to `outDir`: report.html (self-contained), report.json (every number in the
 * report), decisions.csv and decisions.json (one row per analysed decision, with its outcomes), hands.csv
 * (one row per analysed hand and player), events.jsonl (the whole log, which everything is computed from), and the
 * paper: paper.html, printed to paper.pdf when a Chrome is available (`print` is injectable for tests).
 * Free: reads the event log only. Returns the files written.
 */
export function reportCommand(
  config: StudyConfig,
  mock: boolean,
  store: EventStore,
  outDir: string,
  deps: CommandDeps,
  generatedAt = new Date().toISOString(),
  print: (html: string, pdf: string) => boolean = printPdf,
): string[] {
  const c = mock ? mockVariant(config) : config
  const started = Date.now()
  const { report, decisions, hands, events } = analyseStudy(store, c, { focusId: focusPlayer(config), generatedAt })
  mkdirSync(outDir, { recursive: true })
  const files: Array<[string, string]> = [
    ['report.html', renderReportHtml(report)],
    ['report.json', `${JSON.stringify(report, null, 2)}\n`],
    ['decisions.csv', decisionsCsv(decisions)],
    ['decisions.json', `${JSON.stringify(decisions)}\n`],
    ['hands.csv', handsCsv(hands, events)],
    ['events.jsonl', eventsJsonl(events)],
    ['paper.html', renderPaperHtml(report, decisions, { mock })],
  ]
  const written = files.map(([name, content]) => {
    const path = join(outDir, name)
    writeFileSync(path, content)
    return path
  })
  // The paper as a PDF, from the HTML just written: its page setup is in its own @page rules.
  const pdf = join(outDir, 'paper.pdf')
  if (print(join(outDir, 'paper.html'), pdf)) written.push(pdf)
  deps.log(`study ${c.id}: ${report.study.hands} hands, ${report.study.decisions} decisions analysed in ${((Date.now() - started) / 1000).toFixed(1)} s`)
  for (const path of written) deps.log(`  wrote ${path}`)
  if (!written.includes(pdf)) deps.log('  paper.pdf not printed: no Chrome found (set CHROME_PATH); paper.html is there to print')
  return written
}

export interface CliArgs {
  command: 'prereg' | 'run' | 'status' | 'report'
  configPath: string
  mock: boolean
  live: boolean
  takeover: boolean
  db: string
  /** report only: output directory (default reports/<study id>, "-mock" appended in mock mode). */
  out: string | null
}

export const USAGE =
  'usage: pnpm study prereg <config.json> [--mock]\n' +
  '       pnpm study run    <config.json> (--mock | --live) [--takeover] [--db path]\n' +
  '       pnpm study status <config.json> [--mock] [--db path]\n' +
  '       pnpm study report <config.json> [--mock] [--db path] [--out dir]'

/**
 * Strict argument parsing: unknown arguments are errors, and `run` needs an explicit --mock (free)
 * or --live (real money), so a typo can never start a paid run.
 */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  const [command, configPath, ...rest] = argv
  if (command !== 'prereg' && command !== 'run' && command !== 'status' && command !== 'report') throw new Error(`unknown command: ${command ?? '(none)'}`)
  if (!configPath || configPath.startsWith('-')) throw new Error('missing <config.json>')
  const args: CliArgs = { command, configPath, mock: false, live: false, takeover: false, db: 'data/studies.db', out: null }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!
    if (a === '--mock') args.mock = true
    else if (a === '--live' && command === 'run') args.live = true
    else if (a === '--takeover' && command === 'run') args.takeover = true
    else if (a === '--db' && command !== 'prereg') {
      const path = rest[++i]
      if (!path || path.startsWith('-')) throw new Error('--db needs a path')
      args.db = path
    } else if (a === '--out' && command === 'report') {
      const path = rest[++i]
      if (!path || path.startsWith('-')) throw new Error('--out needs a directory')
      args.out = path
    } else throw new Error(`unknown argument for ${command}: ${a}`)
  }
  if (args.mock && args.live) throw new Error('use --mock or --live, not both')
  if (command === 'run' && !args.mock && !args.live) {
    throw new Error('run needs --mock (free rehearsal) or --live (spends real money, up to the study budget)')
  }
  return args
}
