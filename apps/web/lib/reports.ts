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

/** Every report on disk, newest first. Unreadable ones are skipped. */
export function listReports(dir = REPORTS_DIR): StudyReport[] {
  if (!existsSync(dir)) return []
  const out: StudyReport[] = []
  for (const id of readdirSync(dir)) {
    if (!SAFE_ID.test(id)) continue
    const file = join(dir, id, 'report.json')
    if (!existsSync(file)) continue
    try {
      out.push(JSON.parse(readFileSync(file, 'utf8')) as StudyReport)
    } catch {
      // a half-written or old report: skip it
    }
  }
  return out.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
}
