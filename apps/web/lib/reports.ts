import type { StudyReport } from '@ab/study'
import type { ScoredDecision } from '@ab/study/paper'
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
  'hands.csv': 'text/csv; charset=utf-8',
  'events.jsonl': 'application/x-ndjson',
  'paper.pdf': 'application/pdf',
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

/**
 * A rehearsal is a study played by mock players: free, and useful for checking the pipeline and the
 * page, but its numbers are not results and the site never presents them as such.
 */
/**
 * What a report is: a study's results, a pilot (a short paid run to check the pipeline, such as the
 * smoke test: real models, too few hands to report) or a rehearsal on mock players.
 */
export function studyKind(report: StudyReport): 'study' | 'pilot' | 'rehearsal' {
  if (report.study.id.endsWith('-mock') || report.players.some((p) => p.kind === 'mock')) return 'rehearsal'
  if (/^(smoke|pilot)-/.test(report.study.id)) return 'pilot'
  return 'study'
}

/** The newest study that real models played to the end of its protocol, if one has a report. */
export const latestStudy = (entries: ReportEntry[]) => entries.find((e) => studyKind(e.report) === 'study') ?? null

/** Which of the servable files a study's report has (older reports lack the newer ones). */
export function availableFiles(dirName: string, dir = REPORTS_DIR): string[] {
  if (!SAFE_ID.test(dirName)) return []
  return Object.keys(REPORT_FILES).filter((f) => existsSync(join(dir, dirName, f)))
}

/** A study's scored decisions (decisions.json), which the page's figures are computed from. */
export function readDecisions(dirName: string, dir = REPORTS_DIR): ScoredDecision[] {
  if (!SAFE_ID.test(dirName)) return []
  const file = join(dir, dirName, 'decisions.json')
  if (!existsSync(file)) return []
  try {
    const rows: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(rows) ? (rows as ScoredDecision[]) : []
  } catch {
    return []
  }
}

/** Pages in a study's printed paper, or 0 when there is no PDF (counted from its page objects). */
export function paperPages(dirName: string, dir = REPORTS_DIR): number {
  if (!SAFE_ID.test(dirName)) return 0
  const file = join(dir, dirName, 'paper.pdf')
  if (!existsSync(file)) return 0
  return (readFileSync(file, 'latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
}
