import { describe, expect, it } from 'vitest'
import { parseServerConfig } from '../src/config'

describe('parseServerConfig', () => {
  it('has safe defaults: local only, admin API off, $1 per live game', () => {
    expect(parseServerConfig({})).toMatchObject({
      port: 8787,
      host: '127.0.0.1',
      dbPath: 'data/live.db',
      adminToken: null,
      lineupPath: 'lineups/live.json',
      mock: false,
      liveBudgetUsd: 1,
      paceMs: 2500,
      allowedOrigin: null,
    })
  })

  it('reads the environment and --mock', () => {
    const c = parseServerConfig({ PORT: '9000', ADMIN_TOKEN: 'a-long-enough-token', LIVE_BUDGET_USD: '0.5', ALLOWED_ORIGIN: 'http://localhost:3000' }, ['--mock'])
    expect(c).toMatchObject({ port: 9000, adminToken: 'a-long-enough-token', liveBudgetUsd: 0.5, mock: true, allowedOrigin: 'http://localhost:3000' })
    expect(parseServerConfig({ MOCK: '1' }).mock).toBe(true)
  })

  it('rejects typos and weak tokens instead of guessing', () => {
    expect(() => parseServerConfig({ LIVE_BUDGET_USD: '1O' })).toThrow(/LIVE_BUDGET_USD must be a number/)
    expect(() => parseServerConfig({ LIVE_BUDGET_USD: '500' })).toThrow(/from 0.01 to 100/)
    expect(() => parseServerConfig({ ADMIN_TOKEN: 'short' })).toThrow(/at least 16 characters/)
    expect(() => parseServerConfig({}, ['--mok'])).toThrow(/unknown argument/)
    // The free/paid switch accepts only 0 or 1: "true" must not quietly mean paid mode.
    expect(() => parseServerConfig({ MOCK: 'true' })).toThrow(/MOCK must be 0 or 1/)
    expect(parseServerConfig({ MOCK: '0' }).mock).toBe(false)
    expect(() => parseServerConfig({ PORT: '8787.5' })).toThrow(/whole number/)
    expect(() => parseServerConfig({ PORT: '0x10' })).toThrow(/PORT/)
    expect(() => parseServerConfig({ MAX_CLIENTS: '1e3' })).toThrow(/MAX_CLIENTS/)
    expect(() => parseServerConfig({ ALLOWED_ORIGIN: 'http://localhost:3000/' })).toThrow(/origin/)
    expect(() => parseServerConfig({ ALLOWED_ORIGIN: '*' })).toThrow(/origin/)
    expect(() => parseServerConfig({ REPLAY_PACE_MS: '0' })).toThrow(/REPLAY_PACE_MS/) // would replay in a tight loop
  })
})
