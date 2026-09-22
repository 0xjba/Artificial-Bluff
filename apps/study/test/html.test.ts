import { EventStore } from '@ab/core'
import { CallingStation, MockLlm, TagBot } from '@ab/players'
import { describe, expect, it } from 'vitest'
import { parseStudyConfig } from '../src/config'
import { esc, renderReportHtml } from '../src/html'
import { preregistration } from '../src/prereg'
import { analyseStudy } from '../src/report'
import { runStudy } from '../src/run'

const ids = ['jev', 'pill', 'block', 'drip', 'nimbus']
const config = parseStudyConfig({
  id: 'h',
  lineup: ids.map((id) => ({ id, kind: 'mock' })),
  masterSeed: 'm',
  budgetUsd: 10,
  targetHalfWidthBb100: 0.001,
  minGroups: 4,
  maxGroups: 4,
  checkEvery: 4,
  bootstrapResamples: 1000,
})

async function report() {
  const store = new EventStore()
  const players = [new MockLlm('jev', 'mock/jev'), new TagBot('pill'), new CallingStation('block'), new MockLlm('drip', 'vendor/drip'), new CallingStation('nimbus')]
  await runStudy({ config, players, store, prereg: preregistration(config, config.lineup) })
  return analyseStudy(store, config, { focusId: 'jev', generatedAt: '2026-09-22T00:00:00.000Z' }).report
}

describe('renderReportHtml', () => {
  it('renders every section as one self-contained page', async () => {
    const r = await report()
    const html = renderReportHtml(r)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<title>artificialBluff study h</title>')
    for (const h of ['1. Results', '2. Head to head', '3. Cost and latency', '4. Win-probability calibration', '5. Per-action calibration', '6. Reliability', '7. Play style', '8. Method notes', '9. Pre-registration']) {
      expect(html).toContain(h)
    }
    expect(html).toContain(r.study.configHash)
    expect(html).toContain('JEV · mock/jev')
    expect(html).toContain('Holm')
    expect(html).toContain('No win probabilities stated: BLOCK · bot/calling-station, NIMBUS · bot/calling-station.')
    // Two CI charts; A and C charts for the three seats stating win probabilities (the mocks and the TAG
    // bot); per-action charts for each action type a confident player (the two mocks) took.
    const actionCharts = (['fold', 'call', 'check', 'raise'] as const).reduce((n, t) => n + r.calibration.filter((c) => c.actionByType[t].n > 0).length, 0)
    expect(actionCharts).toBeGreaterThan(0)
    expect(html.match(/<svg /g)!.length).toBe(2 + 3 + 3 + actionCharts)
    expect(html).toContain('Folds: right if all-in equity was below the pot odds')
    expect(html).toContain('Model-output fallbacks')
    expect(html).not.toMatch(/<script|<link|src=|href=/) // nothing external, nothing executable
  })

  it('keeps tiny costs and p-values readable, and flags mock and interim reports', async () => {
    const r = await report()
    r.metrics[0]!.costPerDecisionUsd = 0.0000084 // a Jev decision: ~200 tokens at $0.042 per million
    r.contrasts[0]!.pValue = 1e-9
    let html = renderReportHtml(r)
    expect(html).toContain('$0.0000084')
    expect(html).toContain('&lt;0.0001')
    expect(html).toContain('Mock seats (JEV, DRIP)')
    expect(html).not.toContain('Interim report')
    expect(html).toContain('title="focus player">◆</span>')
    r.study.status = 'running'
    html = renderReportHtml(r)
    expect(html).toContain('Interim report: the study has not ended (running)')
  })

  it('escapes everything that comes from the log or the config', async () => {
    const r = await report()
    r.players[0]!.model = '<img src=x onerror=alert(1)>'
    const html = renderReportHtml(r)
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(esc(`a&b"c'<>`)).toBe('a&amp;b&quot;c&#39;&lt;&gt;')
  })
})
