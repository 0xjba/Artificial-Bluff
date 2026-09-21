import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import type { EventBody, EventSink, GameEvent, GameKind } from './events'

export type GameStatus = 'running' | 'ended' | 'interrupted'

export interface GameRow {
  id: string
  kind: GameKind
  createdAt: number
  status: GameStatus
  /**
   * Server-only while the game runs: it contains master seeds, which reveal every future deck.
   * Never send it to spectators before `status !== 'running'`.
   */
  config: unknown
  configHash: string
  endedAt: number | null
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * JSON with object keys sorted, so equal configs hash equally. Strict: accepts only plain objects,
 * arrays, finite numbers, strings, booleans and null (object keys whose value is undefined are
 * dropped, as JSON does). Anything JSON can't represent faithfully (functions, symbols, bigint,
 * NaN/Infinity, Dates, Maps, class instances, undefined in arrays) throws, so two different
 * configs can never share a hash and stored JSON always parses.
 */
export function canonicalJson(value: unknown, path = '$'): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`canonicalJson: ${path} is not a finite number`)
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map((v, i) => canonicalJson(v, `${path}[${i}]`)).join(',')}]`
  if (typeof value === 'object' && isPlainObject(value)) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v, `${path}.${k}`)}`).join(',')}}`
  }
  const kind = typeof value === 'object' ? (value as object).constructor?.name ?? 'object' : typeof value
  throw new Error(`canonicalJson: ${path} is a ${kind}, which JSON cannot represent`)
}

export function configHash(config: unknown): string {
  return createHash('sha256').update(canonicalJson(config)).digest('hex')
}

/** Ordered schema migrations; index i upgrades user_version i to i + 1. Only ever append. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE games (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    config_json TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    ended_at INTEGER
  );
  CREATE TABLE events (
    game_id TEXT NOT NULL REFERENCES games(id),
    seq INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    type TEXT NOT NULL,
    hand_id TEXT,
    body_json TEXT NOT NULL,
    PRIMARY KEY (game_id, seq)
  );
  CREATE INDEX events_hand ON events(game_id, hand_id);
  CREATE TABLE decisions (
    game_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    hand_id TEXT,
    player_id TEXT NOT NULL,
    model TEXT NOT NULL,
    street TEXT NOT NULL,
    position TEXT NOT NULL,
    option_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    chips_in INTEGER NOT NULL,
    pot INTEGER NOT NULL,
    to_call INTEGER NOT NULL,
    win_probability REAL,
    confidence REAL,
    latency_ms REAL NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    reasoning_tokens INTEGER NOT NULL,
    cost_usd REAL NOT NULL,
    retries INTEGER NOT NULL,
    fallback INTEGER NOT NULL,
    fallback_kind TEXT,
    PRIMARY KEY (game_id, seq),
    FOREIGN KEY (game_id, seq) REFERENCES events(game_id, seq)
  );
  CREATE INDEX decisions_hand ON decisions(game_id, hand_id);
  CREATE INDEX decisions_player_model ON decisions(player_id, model);
  `,
]

export const SCHEMA_VERSION = MIGRATIONS.length

/** SQLite event log. Every game is an ordered event stream; decisions are also denormalized for analysis. */
export class EventStore {
  readonly db: Database.Database

  constructor(path = ':memory:') {
    // Wait up to 10 s for another process's write lock instead of failing immediately.
    this.db = new Database(path, { timeout: 10_000 })
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  private migrate(): void {
    this.db
      .transaction(() => {
        const version = this.db.pragma('user_version', { simple: true }) as number
        if (version > SCHEMA_VERSION) throw new Error(`database schema v${version} is newer than this code (v${SCHEMA_VERSION})`)
        for (let v = version; v < SCHEMA_VERSION; v++) this.db.exec(MIGRATIONS[v]!)
        this.db.pragma(`user_version = ${SCHEMA_VERSION}`)
      })
      .immediate()
  }

  createGame(id: string, kind: GameKind, config: unknown, now = Date.now()): GameRow {
    const json = canonicalJson(config) // throws before anything is written
    const hash = createHash('sha256').update(json).digest('hex')
    this.db
      .prepare('INSERT INTO games (id, kind, created_at, status, config_json, config_hash) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, kind, now, 'running', json, hash)
    return this.game(id)!
  }

  game(id: string): GameRow | null {
    const row = this.db.prepare('SELECT * FROM games WHERE id = ?').get(id) as
      | { id: string; kind: GameKind; created_at: number; status: GameStatus; config_json: string; config_hash: string; ended_at: number | null }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      kind: row.kind,
      createdAt: row.created_at,
      status: row.status,
      config: JSON.parse(row.config_json),
      configHash: row.config_hash,
      endedAt: row.ended_at,
    }
  }

  games(kind?: GameKind): GameRow[] {
    const ids = (kind
      ? this.db.prepare('SELECT id FROM games WHERE kind = ? ORDER BY created_at').all(kind)
      : this.db.prepare('SELECT id FROM games ORDER BY created_at').all()) as Array<{ id: string }>
    return ids.map((r) => this.game(r.id)!)
  }

  setStatus(id: string, status: GameStatus, now = Date.now()): void {
    const info = this.db.prepare('UPDATE games SET status = ?, ended_at = ? WHERE id = ?').run(status, status === 'running' ? null : now, id)
    if (info.changes === 0) throw new Error(`no game ${id}`)
  }

  /** Marks games left 'running' by a crash as 'interrupted'. Call on server start. Returns their ids. */
  interruptRunningGames(now = Date.now()): string[] {
    const rows = this.db
      .prepare("UPDATE games SET status = 'interrupted', ended_at = ? WHERE status = 'running' RETURNING id")
      .all(now) as Array<{ id: string }>
    return rows.map((r) => r.id).sort()
  }

  append(gameId: string, body: EventBody, now = Date.now()): GameEvent {
    const json = canonicalJson(body) // rejects NaN/Infinity etc. before anything is written
    // IMMEDIATE: take the write lock up front, so concurrent writers (server + study) wait for it
    // instead of failing with SQLITE_BUSY after reading MAX(seq).
    return this.db
      .transaction((): GameEvent => {
        const { next } = this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM events WHERE game_id = ?').get(gameId) as { next: number }
        const handId = 'handId' in body ? body.handId : null
        this.db
          .prepare('INSERT INTO events (game_id, seq, ts, type, hand_id, body_json) VALUES (?, ?, ?, ?, ?, ?)')
          .run(gameId, next, now, body.type, handId, json)
        if (body.type === 'decision') {
          this.db
            .prepare(
              `INSERT INTO decisions (game_id, seq, hand_id, player_id, model, street, position, option_id, action_type, chips_in, pot, to_call,
               win_probability, confidence, latency_ms, input_tokens, output_tokens, reasoning_tokens, cost_usd, retries,
               fallback, fallback_kind)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              gameId, next, body.handId, body.playerId, body.model, body.street, body.position, body.optionId, body.action.type,
              body.chipsIn, body.pot, body.toCall, body.winProbability, body.confidence, body.latencyMs,
              body.inputTokens, body.outputTokens, body.reasoningTokens, body.costUsd, body.retries,
              body.fallback ? 1 : 0, body.fallbackKind,
            )
        }
        // Return exactly what was stored (e.g. no undefined keys), so live listeners and replays see the same event.
        return { ...(JSON.parse(json) as EventBody), gameId, seq: next, ts: now } as GameEvent
      })
      .immediate()
  }

  /** A sink bound to one game, for the runner. */
  sink(gameId: string, now: () => number = Date.now): EventSink {
    return { append: (body) => this.append(gameId, body, now()) }
  }

  events(gameId: string, afterSeq = 0): GameEvent[] {
    const rows = this.db
      .prepare('SELECT seq, ts, body_json FROM events WHERE game_id = ? AND seq > ? ORDER BY seq')
      .all(gameId, afterSeq) as Array<{ seq: number; ts: number; body_json: string }>
    return rows.map((r) => ({ ...(JSON.parse(r.body_json) as EventBody), gameId, seq: r.seq, ts: r.ts }) as GameEvent)
  }

  /** Total spent by all players in a game (USD). */
  gameCost(gameId: string): number {
    const { total } = this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM decisions WHERE game_id = ?').get(gameId) as { total: number }
    return total
  }

  close(): void {
    this.db.close()
  }
}
