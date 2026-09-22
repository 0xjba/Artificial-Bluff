'use client'
import { useState } from 'react'

export interface ReportPage {
  /** Page number, from 1. */
  n: number
  title: string
  body: React.ReactNode
}

/**
 * The technical report, read as a spread of pages (the design's reader). The pages are built from the
 * study's own numbers, so nothing here is a picture of a document we don't have: "Download" gives the
 * generated report and its data files.
 */
export function ReportViewer({ pages, label, files }: { pages: ReportPage[]; label: string; files: Array<{ href: string; label: string }> }) {
  const [fitWidth, setFitWidth] = useState(false)
  const [at, setAt] = useState(0)
  const perSpread = fitWidth ? 1 : 2
  const start = Math.min(at, Math.max(0, pages.length - perSpread))
  const shown = pages.slice(start, start + perSpread)
  const first = shown[0]?.n ?? 1
  const last = shown.at(-1)?.n ?? first
  const step = (by: number) => setAt((i) => Math.max(0, Math.min(pages.length - perSpread, i + by * perSpread)))

  return (
    <div className="reader">
      <div className="reader-bar">
        <span className="file">{label}</span>
        <span className="tools">
          <button type="button" aria-pressed={fitWidth} onClick={() => setFitWidth((f) => !f)}>
            {fitWidth ? 'TWO PAGES' : 'FIT WIDTH'}
          </button>
          {files.map((f) => (
            <a key={f.href} className="download" href={f.href}>
              {f.label}
            </a>
          ))}
        </span>
      </div>

      <div className="reader-spread">
        <div className={`spread${fitWidth ? ' one' : ''}`}>
          {shown.map((p) => (
            <article className="sheet" key={p.n} aria-label={`page ${p.n}: ${p.title}`}>
              <h3>{p.title}</h3>
              {p.body}
              <span className="folio">{p.n}</span>
            </article>
          ))}
        </div>
      </div>

      <div className="reader-nav">
        <button type="button" aria-label="previous page" disabled={start === 0} onClick={() => step(-1)}>
          ←
        </button>
        <button type="button" aria-label="next page" disabled={start + perSpread >= pages.length} onClick={() => step(1)}>
          →
        </button>
        <span className="count">
          {first === last ? `PAGE ${first}` : `PAGES ${first}–${last}`} OF {pages.length}
        </span>
        <span className="segments">
          {pages.map((p) => (
            <button
              key={p.n}
              type="button"
              className={p.n >= first && p.n <= last ? 'on' : ''}
              aria-label={`go to page ${p.n}`}
              onClick={() => setAt(fitWidth ? p.n - 1 : Math.floor((p.n - 1) / 2) * 2)}
            />
          ))}
        </span>
        <span className="hint">Every page is built from the study&apos;s own numbers.</span>
      </div>
    </div>
  )
}
