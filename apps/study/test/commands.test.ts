import { EventStore } from '@ab/core'
import { describe, expect, it } from 'vitest'
import { mockVariant, preregCommand, runCommand, statusCommand } from '../src/commands'
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

  it('runs a mock study and reports status', async () => {
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
})
