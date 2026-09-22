import type { StudyReport } from '@ab/study'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Where `pnpm study report` writes (reports/<study id>/), from the repo root by default. Read at
 * request time, never bundled: the ignore hint stops the build from tracing the whole project.
 */
export const REPORTS_DIR = resolve(/* turbopackIgnore: true */ process.env.REPORTS_DIR ?? join(process.cwd(), '../../reports'))

/** Files of a report that may be downloaded, and their types. */
export const REPORT_FILES: Record<string, string> = {
  'report.html': 'text/html; charset=utf-8',
  'report.json': 'application/json',
  'decisions.csv': 'text/csv; charset=utf-8',
  'decisions.json': 'application/json',
}

/** Study ids are directory names we wrote: letters, digits, dot, dash, underscore. */
export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** A report and the folder it was found in (links use the folder: mock reports live in `<id>-mock`). */
export interface ReportEntry {
  dir: string
  report: StudyReport
}

/** Enough of a report's shape to render it; older or half-written files are skipped, not crashed on. */
function looksLikeReport(r: unknown): r is StudyReport {
  const x = r as Partial<StudyReport> | null
  return (
    !!x &&
    typeof x.generatedAt === 'string' &&
    typeof x.study?.id === 'string' &&
    typeof x.study.configHash === 'string' &&
    Array.isArray(x.players) &&
    Array.isArray(x.results) &&
    Array.isArray(x.metrics) &&
    Array.isArray(x.calibration) &&
    Array.isArray(x.contrasts)
  )
}

/** Every readable report on disk, newest first. */
export function listReports(dir = REPORTS_DIR): ReportEntry[] {
  if (!existsSync(dir)) return []
  const out: ReportEntry[] = []
  for (const name of readdirSync(dir)) {
    if (!SAFE_ID.test(name)) continue
    const file = join(dir, name, 'report.json')
    if (!existsSync(file)) continue
    try {
      const report: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (looksLikeReport(report)) out.push({ dir: name, report })
    } catch {
      // a half-written file: skip it
    }
  }
  return out.sort((a, b) => b.report.generatedAt.localeCompare(a.report.generatedAt))
}
