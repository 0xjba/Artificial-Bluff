import type { LogLine } from '../lib/log'

/** The running action log, newest first. */
export function ActionLog({ lines }: { lines: LogLine[] }) {
  return (
    <section className="log" aria-label="action log">
      <ol>
        {[...lines].reverse().map((l) => (
          <li key={l.seq} className={l.kind}>
            {l.text}
          </li>
        ))}
      </ol>
    </section>
  )
}
