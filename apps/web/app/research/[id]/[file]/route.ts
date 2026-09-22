import { createReadStream, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { REPORT_FILES, REPORTS_DIR, SAFE_ID } from '../../../../lib/reports'

/** Serves a study report's files (an allow-list of names; the id must be a plain directory name). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await params
  const type = REPORT_FILES[file]
  if (!type || !SAFE_ID.test(id)) return new Response('not found', { status: 404 })
  const path = join(REPORTS_DIR, id, file)
  if (!existsSync(path) || !statSync(path).isFile()) return new Response('not found', { status: 404 })
  const headers: Record<string, string> = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=60' }
  // The HTML report is self-contained and script-free; still, lock it down.
  if (file.endsWith('.html')) headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox; frame-ancestors 'none'"
  else headers['Content-Disposition'] = `attachment; filename="${id}-${file}"`
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers })
}
