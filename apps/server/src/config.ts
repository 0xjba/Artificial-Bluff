/** Server settings, from environment variables (and `--mock` on the command line). */
export interface ServerConfig {
  port: number
  host: string
  dbPath: string
  /** Bearer token for the admin API; null disables it (no way to start a paid game). */
  adminToken: string | null
  /** Line-up file for live games (ignored in mock mode). */
  lineupPath: string
  /** Free mode: every paid seat becomes a mock player. */
  mock: boolean
  /** Spending cap per live game (USD). */
  liveBudgetUsd: number
  /** Pause after each action in a live game, so spectators can follow. */
  paceMs: number
  decisionTimeoutMs: number
  /** Pause after each action when replaying. */
  replayPaceMs: number
  /** How long the final result of a live game stays on screen before replays resume. */
  cooldownMs: number
  /** Origin allowed to call the API from a browser (the web app in development), or null. */
  allowedOrigin: string | null
  /** Most spectator connections at once. */
  maxClients: number
}

type Env = Record<string, string | undefined>

function number(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${key} must be a number from ${min} to ${max}, got "${raw}"`)
  return value
}

/** Reads the server settings; throws on a malformed value so a typo can't silently change behaviour. */
export function parseServerConfig(env: Env, argv: readonly string[] = []): ServerConfig {
  const unknown = argv.filter((a) => a !== '--mock')
  if (unknown.length) throw new Error(`unknown argument(s): ${unknown.join(' ')} (usage: pnpm live [--mock])`)
  const token = env.ADMIN_TOKEN?.trim() || null
  if (token !== null && token.length < 16) throw new Error('ADMIN_TOKEN must be at least 16 characters (or unset to disable the admin API)')
  return {
    port: number(env, 'PORT', 8787, 0, 65_535),
    host: env.HOST?.trim() || '127.0.0.1',
    dbPath: env.DB_PATH?.trim() || 'data/live.db',
    adminToken: token,
    lineupPath: env.LINEUP?.trim() || 'lineups/live.json',
    mock: argv.includes('--mock') || env.MOCK === '1',
    liveBudgetUsd: number(env, 'LIVE_BUDGET_USD', 1, 0.01, 100),
    paceMs: number(env, 'PACE_MS', 2500, 0, 60_000),
    decisionTimeoutMs: number(env, 'DECISION_TIMEOUT_MS', 20_000, 1000, 300_000),
    replayPaceMs: number(env, 'REPLAY_PACE_MS', 1500, 0, 60_000),
    cooldownMs: number(env, 'COOLDOWN_MS', 30_000, 0, 600_000),
    allowedOrigin: env.ALLOWED_ORIGIN?.trim() || null,
    maxClients: number(env, 'MAX_CLIENTS', 500, 1, 100_000),
  }
}
