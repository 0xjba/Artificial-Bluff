import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Where a Chrome or Chromium usually lives; CHROME_PATH wins. */
const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

/** A Chrome to print with, or null (the paper is still written as HTML without one). */
export function findChrome(env: NodeJS.ProcessEnv = process.env, candidates: readonly string[] = CANDIDATES): string | null {
  if (env.CHROME_PATH) return existsSync(env.CHROME_PATH) ? env.CHROME_PATH : null
  return candidates.find((c) => existsSync(c)) ?? null
}

/**
 * Prints an HTML file to PDF with headless Chrome: the paper's page size, margins and page numbers
 * come from its own @page rules. Returns false (and writes nothing) when there is no Chrome.
 */
export function printPdf(htmlPath: string, pdfPath: string, chrome: string | null = findChrome()): boolean {
  if (!chrome) return false
  const run = spawnSync(
    chrome,
    ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--print-to-pdf-no-header', `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href],
    { stdio: 'ignore', timeout: 120_000 },
  )
  return run.status === 0 && existsSync(pdfPath) && statSync(pdfPath).size > 0
}
