import { configHash, EventStore } from '@ab/core'
import { adaptLineup, createPlayers, fetchModelCatalog, type PlayerEnv, type PlayerSpec } from '@ab/players'
import { readFileSync } from 'node:fs'
import { parseStudyConfig, type StudyConfig } from './config'
import { preregistration } from './prereg'
import { completedPrefix, readStoreProgress } from './progress'
import { summarize, type StudySummary } from './results'
import { runStudy, type StudyOutcome } from './run'

export function loadStudyConfig(path: string): StudyConfig {
  return parseStudyConfig(JSON.parse(readFileSync(path, 'utf8')))
}

/** A free dry run: every paid seat becomes a mock, under a separate study id so data never mixes. */
export function mockVariant(config: StudyConfig): StudyConfig {
  const lineup: PlayerSpec[] = config.lineup.map((s) =>
    s.kind === 'jev' || s.kind === 'llm' ? { id: s.id, kind: 'mock', model: `mock/${s.model}` } : s,
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
  const lineup = await resolveLineup(c, mock, deps.log)
  const players = createPlayers(lineup, deps.env)
  const prereg = preregistration(c, lineup)
  if (mock) deps.log('mock mode: no API calls are made; costs shown are simulated')
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
  const progress = readStoreProgress(store, c.id)
  const prefix = completedPrefix(progress, c.lineup.length, c.maxGroups)
  deps.log(`study ${c.id}: ${game.status}${progress.lastEnd ? ` (${progress.lastEnd})` : ''}, ${progress.handsPlayed} hands played, hash ${game.configHash.slice(0, 12)}…`)
  formatSummary(summarize(progress, c, prefix), store.gameCost(c.id)).forEach(deps.log)
}
