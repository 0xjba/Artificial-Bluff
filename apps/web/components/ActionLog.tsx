import type { LogLine } from '../lib/log'

/** Log lines grouped by hand, newest hand first; each hand's header stays on top, its lines newest first. */
export function logOrder(lines: LogLine[]): LogLine[] {
  const groups: LogLine[][] = []
  for (const l of lines) {
    if (l.kind === 'hand' || groups.length === 0) groups.push([l])
    else groups.at(-1)!.push(l)
  }
  return groups.reverse().flatMap((g) => (g[0]!.kind === 'hand' ? [g[0]!, ...g.slice(1).reverse()] : [...g].reverse()))
}

/** The running action log, in plain words. */
export function ActionLog({ lines }: { lines: LogLine[] }) {
  return (
    <section className="log" aria-label="action log">
      <ol>
        {logOrder(lines).map((l) => (
          <li key={l.seq} className={l.kind}>
            {l.text}
          </li>
        ))}
      </ol>
    </section>
  )
}
