import { EventStore } from '@ab/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mockVariant, parseCliArgs, preregCommand, reportCommand, runCommand, statusCommand } from '../src/commands'
import { parseStudyConfig } from '../src/config'

const config = parseStudyConfig({
  id: 'smoke',
  lineup: [
    { id: 'hex', kind: 'jev', model: 'jev-1.13.0' },
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

  it('writes a report of a mock study for free', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('reports must not use the network')))
    const store = new EventStore()
    await runCommand(config, true, store, capture().deps)
    const out = mkdtempSync(join(tmpdir(), 'ab-report-'))
    const { lines, deps } = capture()
    // The PDF step is a stand-in here (tests don't launch Chrome); it gets the paper that was written.
    const printed: string[] = []
    const print = (html: string, pdf: string) => {
      printed.push(readFileSync(html, 'utf8'))
      writeFileSync(pdf, '%PDF-1.7 stand-in')
      return true
    }
    const files = reportCommand(config, true, store, out, deps, '2026-09-22T00:00:00.000Z', print)
    expect(files.map((f) => f.slice(out.length + 1))).toEqual(['report.html', 'report.json', 'decisions.csv', 'decisions.json', 'hands.csv', 'events.jsonl', 'paper.html', 'paper.pdf'])
    // The whole log, one event per line: every figure can be recomputed from it.
    const log = readFileSync(join(out, 'events.jsonl'), 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l))
    expect(log).toEqual(store.events('smoke-mock'))
    expect(printed[0]).toContain('REHEARSAL ON MOCK PLAYERS') // a mock study's paper says what it is
    // Without a Chrome the paper is still written as HTML, and the log says why there is no PDF.
    const bare = capture()
    const noPdf = reportCommand(config, true, store, mkdtempSync(join(tmpdir(), 'ab-report-')), bare.deps, '2026-09-22T00:00:00.000Z', () => false)
    expect(noPdf.at(-1)).toMatch(/paper\.html$/)
    expect(bare.lines.at(-1)).toMatch(/paper\.pdf not printed/)
    expect(lines[0]).toMatch(/^study smoke-mock: 20 hands, \d+ decisions analysed in/)
    const json = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))
    expect(json).toMatchObject({ kind: 'artificialBluff study report', focusId: 'hex', study: { id: 'smoke-mock', hands: 20 } })
    const rows = JSON.parse(readFileSync(join(out, 'decisions.json'), 'utf8'))
    expect(readFileSync(join(out, 'decisions.csv'), 'utf8').trimEnd().split('\n')).toHaveLength(rows.length + 1)
    expect(readFileSync(join(out, 'report.html'), 'utf8')).toContain('study smoke-mock')
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
    expect(parseCliArgs(['report', 'x.json', '--mock', '--out', 'r'])).toMatchObject({ command: 'report', mock: true, out: 'r' })
    expect(parseCliArgs(['report', 'x.json']).out).toBeNull()
    expect(() => parseCliArgs(['report', 'x.json', '--out'])).toThrow(/--out needs a directory/)
    expect(() => parseCliArgs(['run', 'x.json', '--mock', '--out', 'r'])).toThrow(/unknown argument for run: --out/)
    expect(() => parseCliArgs(['report', 'x.json', '--live'])).toThrow(/unknown argument for report: --live/)
  })

})
