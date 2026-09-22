import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'ab-reports-'))
process.env.REPORTS_DIR = dir
const report = (id: string, generatedAt: string) => ({
  study: { id, configHash: 'h' },
  generatedAt,
  players: [],
  results: [],
  metrics: [],
  calibration: [],
  contrasts: [],
})
mkdirSync(join(dir, 'older'))
writeFileSync(join(dir, 'older', 'report.json'), JSON.stringify(report('older', '2026-09-01T00:00:00Z')))
writeFileSync(join(dir, 'older', 'report.html'), '<!doctype html><title>r</title>')
mkdirSync(join(dir, 'newer'))
writeFileSync(join(dir, 'newer', 'report.json'), JSON.stringify(report('newer', '2026-09-20T00:00:00Z')))
mkdirSync(join(dir, 'broken'))
writeFileSync(join(dir, 'broken', 'report.json'), '{ half')
mkdirSync(join(dir, 'empty'))
// A mock report lives in <id>-mock; an old report without the current fields is skipped.
mkdirSync(join(dir, 'older-mock'))
writeFileSync(join(dir, 'older-mock', 'report.json'), JSON.stringify(report('older', '2026-09-10T00:00:00Z')))
mkdirSync(join(dir, 'ancient'))
writeFileSync(join(dir, 'ancient', 'report.json'), JSON.stringify({ study: { id: 'ancient' } }))

const { listReports } = await import('../lib/reports')
const { GET } = await import('../app/research/[id]/[file]/route')
const get = (id: string, file: string) => GET(new Request('http://x'), { params: Promise.resolve({ id, file }) })

describe('research reports', () => {
  it('lists readable reports newest first with their folders, and skips broken, empty or outdated ones', () => {
    expect(listReports().map((e) => [e.dir, e.report.study.id])).toEqual([
      ['newer', 'newer'],
      ['older-mock', 'older'],
      ['older', 'older'],
    ])
  })

  it('serves only allow-listed files of plain study ids, the HTML locked down', async () => {
    const html = await get('older', 'report.html')
    expect(html.status).toBe(200)
    expect(html.headers.get('content-type')).toMatch(/text\/html/)
    expect(html.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(await html.text()).toContain('<title>r</title>')
    const json = await get('older', 'report.json')
    expect(json.headers.get('content-disposition')).toContain('older-report.json')
    expect((await get('older', 'secret.txt')).status).toBe(404)
    expect((await get('..', 'report.json')).status).toBe(404)
    expect((await get('newer', 'report.html')).status).toBe(404) // not written
    expect(html.headers.get('content-security-policy')).toContain('sandbox')
  })
})
