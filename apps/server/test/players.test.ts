import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mockSpecs, prepareLivePlayers } from '../src/players'

const lineupFile = (players: unknown[]) => {
  const path = join(mkdtempSync(join(tmpdir(), 'ab-lineup-')), 'live.json')
  writeFileSync(path, JSON.stringify({ players }))
  return path
}
const seats = [
  { id: 'hex', kind: 'jev', model: 'jev-1.13.0' },
  { id: 'pill', kind: 'llm', model: 'vendor/model' },
  { id: 'drip', kind: 'bot', bot: 'tag' },
]
const catalog = async () => new Map([['vendor/model', { id: 'vendor/model', supported_parameters: ['structured_outputs', 'temperature'] }]])

describe('live players', () => {
  it('turns paid seats into free mocks', () => {
    expect(mockSpecs(seats as never)).toEqual([
      { id: 'hex', kind: 'mock', model: 'mock/jev-1.13.0' },
      { id: 'pill', kind: 'mock', model: 'mock/vendor/model' },
      { id: 'drip', kind: 'bot', bot: 'tag' },
    ])
  })

  it('mock mode needs no keys and no network', async () => {
    const noNetwork = async () => {
      throw new Error('mock mode must not call the catalog')
    }
    const players = await prepareLivePlayers({ lineupPath: lineupFile(seats), mock: true, env: {} }, noNetwork)
    expect(players.make().map((p) => p.kind)).toEqual(['mock', 'mock', 'bot'])
  })

  it('checks a real line-up at start-up: catalog, request flags and keys', async () => {
    const path = lineupFile(seats)
    await expect(prepareLivePlayers({ lineupPath: path, mock: false, env: {} }, catalog)).rejects.toThrow(/API_KEY is not set/)
    const env = { OPENROUTER_API_KEY: 'k', TYPESAFE_API_KEY: 'k' }
    const ok = await prepareLivePlayers({ lineupPath: path, mock: false, env }, catalog)
    expect(ok.specs[1]).toMatchObject({ structuredOutput: true, sendTemperature: true })
    expect(ok.make()).toHaveLength(3)
    const unknown = lineupFile([seats[0], { id: 'x', kind: 'llm', model: 'nobody/model' }])
    await expect(prepareLivePlayers({ lineupPath: unknown, mock: false, env }, catalog)).rejects.toThrow(/not in the OpenRouter catalog/)
    await expect(prepareLivePlayers({ lineupPath: '/nope.json', mock: false, env }, catalog)).rejects.toThrow(/no line-up at/)
  })
})
