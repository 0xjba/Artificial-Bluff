'use client'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useEffect, useRef, useState } from 'react'
import styles from '../../app/research/research.module.css'
import { spread, stepFrom } from '../../lib/spread'

/** At or above this width the paper shows as a spread of two pages, like a printed report. */
const SPREAD_FROM = 760

/**
 * The paper, page by page, drawn with pdf.js: a browser's own PDF viewer is poor on a phone and can't be
 * styled. Two pages side by side where there is room, one on a phone; the PDF itself is always a
 * download away.
 */
export function PaperViewer({ src, download, pages: expected }: { src: string; download: string; pages: number }) {
  const frame = useRef<HTMLDivElement>(null)
  const canvases = useRef<Array<HTMLCanvasElement | null>>([])
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [failed, setFailed] = useState(false)
  const [first, setFirst] = useState(1)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const pdfjs = await import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
      const loaded = await pdfjs.getDocument({ url: src }).promise
      if (!cancelled) setDoc(loaded)
    })().catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [src])

  useEffect(() => {
    const el = frame.current
    if (!el) return
    // Measured at once, then kept up to date: the first layout shouldn't wait for an observer callback
    // (a page opened in a background tab gets none until it is shown).
    const style = getComputedStyle(el)
    setWidth(el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const total = doc?.numPages ?? expected
  const perView = width >= SPREAD_FROM ? 2 : 1
  const { pages: shown, canBack, canForward } = spread(first, perView, total)
  const start = shown[0] ?? 1

  useEffect(() => {
    if (!doc || !width) return
    let cancelled = false
    const gap = 16
    const pageWidth = (width - gap * (shown.length - 1)) / shown.length
    shown.forEach(async (n, i) => {
      const page = await doc.getPage(n)
      const canvas = canvases.current[i]
      if (cancelled || !canvas) return
      const base = page.getViewport({ scale: 1 })
      const scale = pageWidth / base.width
      const ratio = window.devicePixelRatio || 1
      const view = page.getViewport({ scale: scale * ratio })
      canvas.width = Math.floor(view.width)
      canvas.height = Math.floor(view.height)
      canvas.style.width = `${Math.floor(view.width / ratio)}px`
      canvas.style.height = `${Math.floor(view.height / ratio)}px`
      await page.render({ canvas, viewport: view }).promise
    })
    return () => {
      cancelled = true
    }
  }, [doc, width, start, shown.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const step = (by: number) => setFirst((p) => stepFrom(p, by, perView, total))
  const label = shown.length > 1 ? `Pages ${shown[0]}–${shown.at(-1)} of ${total}` : `Page ${shown[0] ?? 1} of ${total}`

  return (
    <div className={styles.paper}>
      <div className={styles['paper-frame']} ref={frame}>
        {failed ? (
          <p className={styles['paper-fallback']}>
            The paper couldn&apos;t be shown here. <a href={download}>Download the PDF</a> to read it.
          </p>
        ) : (
          <div className={styles['paper-pages']}>
            {shown.map((n, i) => (
              <canvas
                key={n}
                ref={(el) => {
                  canvases.current[i] = el
                }}
                className={styles['paper-page']}
                aria-label={`page ${n} of the paper`}
              />
            ))}
          </div>
        )}
      </div>
      <div className={styles['paper-bar']}>
        <button type="button" aria-label="previous page" disabled={!canBack} onClick={() => step(-1)}>
          ←
        </button>
        <span className={styles['paper-count']}>{label}</span>
        <button type="button" aria-label="next page" disabled={!canForward} onClick={() => step(1)}>
          →
        </button>
        <a className={styles['paper-download']} href={download}>
          Download PDF
        </a>
      </div>
    </div>
  )
}
