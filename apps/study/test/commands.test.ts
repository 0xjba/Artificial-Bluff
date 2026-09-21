import { EventStore } from '@ab/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockVariant, parseCliArgs, preregCommand, runCommand, statusCommand } from '../src/commands'
import { parseStudyConfig } from '../src/config'

const config = parseStudyConfig({
  id: 'smoke',
  lineup: [
    { id: 'jev', kind: 'jev', model: 'jev-1.13.0' },
    { id: 'pill', kind: 'llm', model: 'vendor/frontier' },
    { id: 'drip', kind: 'bot', bot: 'tag' },
    { id: 'block', kind: 'llm', model: 'vendor/other' },
    { id: 'nimbus', kind: 'bot', bot: 'calling-station' },
  ],
  masterSeed: 'm',
  budgetUsd: 1,
  targetHalfWidthBb100: 1,
  minGroups: 4,
  maxGroups: 4,
  checkEvery: 4,
  concurrency: 2,
  bootstrapResamples: 1000,
})

describe('study commands (mock mode: free, no network, no keys)', () => {
  const capture = () => {
    const lines: string[] = []
    return { lines, deps: { env: {}, log: (l: string) => lines.push(l) } }
  }

  it('turns paid seats into mocks under a separate study id', () => {
    const m = mockVariant(config)
    expect(m.id).toBe('smoke-mock')
    expect(m.lineup.map((s) => s.kind)).toEqual(['mock', 'mock', 'bot', 'mock', 'bot'])
    expect(m.lineup[1]).toEqual({ id: 'pill', kind: 'mock', model: 'mock/vendor/frontier' })
  })

  it('prints the pre-registration and its hash', async () => {
    const { lines, deps } = capture()
    const hash = await preregCommand(config, true, deps)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(lines.at(-1)).toBe(`pre-registration hash: ${hash}`)
    expect(JSON.parse(lines[0]!)).toMatchObject({ kind: 'artificialBluff study', study: { id: 'smoke-mock' } })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('runs a mock study and reports status', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('mock mode must not use the network')))
    const store = new EventStore()
    const run = capture()
    const outcome = await runCommand(config, true, store, run.deps)
    expect(outcome.reason).toBe('max_groups')
    expect(run.lines.some((l) => l.startsWith('ended: max_groups'))).toBe(true)
    const status = capture()
    statusCommand(config, true, store, status.deps)
    expect(status.lines[0]).toMatch(/^study smoke-mock: ended \(max_groups\), 20 hands played/)
    expect(status.lines.some((l) => l.includes('bb/100'))).toBe(true)
  })

  it('reports a study that has not started', () => {
    const { lines, deps } = capture()
    statusCommand(config, true, new EventStore(), deps)
    expect(lines).toEqual(['study smoke-mock has not started'])
  })

  it('refuses to resume a study whose budget is spent, and says a finished study is finished', async () => {
    const store = new EventStore()
    const broke = { ...config, budgetUsd: 0.00001 }
    expect((await runCommand(broke, true, store, capture().deps)).reason).toBe('budget_cap')
    await expect(runCommand(broke, true, store, capture().deps)).rejects.toThrow(/budget already spent .* raise budgetUsd/)
    const done = new EventStore()
    await runCommand(config, true, done, capture().deps)
    const again = capture()
    await runCommand(config, true, done, again.deps)
    expect(again.lines[0]).toBe('study smoke-mock already finished (max_groups)')
  })
})

describe('study CLI arguments', () => {
  it('needs an explicit --mock or --live to run, so a typo never starts a paid run', () => {
    expect(parseCliArgs(['run', 'x.json', '--mock'])).toMatchObject({ command: 'run', mock: true, live: false, db: 'data/studies.db' })
    expect(parseCliArgs(['run', 'x.json', '--live', '--takeover', '--db', 'd.db'])).toMatchObject({ live: true, takeover: true, db: 'd.db' })
    expect(() => parseCliArgs(['run', 'x.json'])).toThrow(/--mock \(free rehearsal\) or --live \(spends real money/)
    expect(() => parseCliArgs(['run', 'x.json', '--Mock'])).toThrow(/unknown argument for run: --Mock/)
    expect(() => parseCliArgs(['run', 'x.json', '--mock', '--live'])).toThrow(/not both/)
    expect(() => parseCliArgs(['run', 'x.json', '--mock', '--db'])).toThrow(/--db needs a path/)
    expect(() => parseCliArgs(['run', 'x.json', '--db', '--mock'])).toThrow(/--db needs a path/)
    expect(() => parseCliArgs(['status', 'x.json', '--live'])).toThrow(/unknown argument/)
    expect(() => parseCliArgs(['go', 'x.json'])).toThrow(/unknown command/)
    expect(() => parseCliArgs(['run'])).toThrow(/missing <config.json>/)
  })
})
