import { adaptLineup, createPlayers, fetchModelCatalog, type CatalogModel, type Player, type PlayerEnv, type PlayerSpec } from '@ab/players'
import { existsSync, readFileSync } from 'node:fs'

export const EXAMPLE_LINEUP = 'lineups/live.example.json'

/** A free line-up: every paid seat (Jev, LLM) becomes a mock player named after its model. */
export function mockSpecs(specs: readonly PlayerSpec[]): PlayerSpec[] {
  return specs.map((s) => (s.kind === 'jev' || s.kind === 'llm' ? { id: s.id, kind: 'mock', model: `mock/${s.model}` } : s))
}

export function readLineup(path: string): PlayerSpec[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { players?: unknown }
  if (!Array.isArray(raw.players) || raw.players.length < 2) throw new Error(`${path}: expected { "players": [ ...at least 2 seats ] }`)
  return raw.players as PlayerSpec[]
}

export interface LivePlayers {
  /** The seats as they will play (request flags adapted, or mocks). */
  specs: PlayerSpec[]
  /** Fresh players for one game. */
  make: () => Player[]
}

/**
 * Prepares the live line-up once at start-up. Mock mode is free and needs no keys (it falls back to the
 * example line-up). A real line-up is checked against the model catalog (a free call) and must have
 * its keys, so problems show up at start-up, not when an admin starts a game.
 */
export async function prepareLivePlayers(
  opts: { lineupPath: string; mock: boolean; env: PlayerEnv },
  catalog: () => Promise<Map<string, CatalogModel>> = () => fetchModelCatalog(),
): Promise<LivePlayers> {
  if (opts.mock) {
    const path = existsSync(opts.lineupPath) ? opts.lineupPath : EXAMPLE_LINEUP
    const specs = mockSpecs(readLineup(path))
    createPlayers(specs, {})
    return { specs, make: () => createPlayers(specs, {}) }
  }
  if (!existsSync(opts.lineupPath)) throw new Error(`no line-up at ${opts.lineupPath}: copy ${EXAMPLE_LINEUP} (or run with --mock)`)
  const { specs, problems } = adaptLineup(readLineup(opts.lineupPath), await catalog())
  const unknown = problems.filter((p) => p.includes('not in the OpenRouter catalog'))
  if (unknown.length) throw new Error(`line-up problems: ${unknown.join('; ')}`)
  createPlayers(specs, opts.env) // throws now if a key is missing
  return { specs, make: () => createPlayers(specs, opts.env) }
}
