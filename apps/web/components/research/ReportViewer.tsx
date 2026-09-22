'use client'
import { useState } from 'react'
import styles from '../../app/research/research.module.css'

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
    <div className={styles.reader}>
      <div className={styles['reader-bar']}>
        <span className={styles.file}>{label}</span>
        <span className={styles.tools}>
          <button type="button" aria-pressed={fitWidth} onClick={() => setFitWidth((f) => !f)}>
            {fitWidth ? 'TWO PAGES' : 'FIT WIDTH'}
          </button>
          {files.map((f) => (
            <a key={f.href} className={styles.download} href={f.href}>
              {f.label}
            </a>
          ))}
        </span>
      </div>

      <div className={styles['reader-spread']}>
        <div className={`${styles.spread}${fitWidth ? ` ${styles.one}` : ''}`}>
          {shown.map((p) => (
            <article className={styles.sheet} key={p.n} aria-label={`page ${p.n}: ${p.title}`}>
              <h3>{p.title}</h3>
              {p.body}
              <span className={styles.folio}>{p.n}</span>
            </article>
          ))}
        </div>
      </div>

      <div className={styles['reader-nav']}>
        <button type="button" aria-label="previous page" disabled={start === 0} onClick={() => step(-1)}>
          ←
        </button>
        <button type="button" aria-label="next page" disabled={start + perSpread >= pages.length} onClick={() => step(1)}>
          →
        </button>
        <span className={styles.count}>
          {first === last ? `PAGE ${first}` : `PAGES ${first}–${last}`} OF {pages.length}
        </span>
        <span className={styles.segments}>
          {pages.map((p) => (
            <button
              key={p.n}
              type="button"
              className={p.n >= first && p.n <= last ? styles.on : ''}
              aria-label={`go to page ${p.n}`}
              onClick={() => setAt(fitWidth ? p.n - 1 : Math.floor((p.n - 1) / 2) * 2)}
            />
          ))}
        </span>
        <span className={styles.hint}>Every page is built from the study&apos;s own numbers.</span>
      </div>
    </div>
  )
}
