'use client'
import type { TableView } from '@ab/core/view'
import { characterFor } from '@ab/mascot'
import { fallbackNotice, ms, pct, shortModel, usd } from '../lib/format'

const optionName = (id: string) => id.replace(/_/g, ' ').replace(/\b(\d)(\d)bb\b/, '$1.$2bb')

/**
 * The last decision: who acted, what they did, the chance they gave themselves against the true
 * chance, and how sure they were. Jev answers with a probability for every option, so it shows those
 * bars; the LLMs write a line of reasoning instead.
 */
export function DecisionCard({ view, decisionEquity }: { view: TableView; decisionEquity: number | null }) {
  const d = view.lastDecision
  if (!d)
    return (
      <section className="decision empty">
        <h2>LAST DECISION</h2>
        <p className="muted">Decisions will appear here.</p>
        <span className="sr-only" aria-live="polite" />
      </section>
    )
  const seat = view.seats.find((s) => s.playerId === d.playerId)
  const who = characterFor(d.playerId, view.seats.findIndex((s) => s.playerId === d.playerId))
  const entries = d.optionProbabilities ? Object.entries(d.optionProbabilities) : []
  const probs = entries.length ? entries.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 5) : null
  return (
    <section className="decision" style={{ '--seat': who.color } as React.CSSProperties}>
      {/* Screen readers hear one short line per decision, not the whole panel. */}
      <span className="sr-only" aria-live="polite">{`${who.name}: ${d.label}`}</span>
      <h2>
        LAST DECISION <b>{who.name}</b> <span className="action">{d.label}</span>
      </h2>
      <div className="claims">
        <div>
          <span>IT SAID</span>
          <b>{pct(d.winProbability)}</b>
        </div>
        <div>
          <span>TRUE</span>
          <b className="true">{pct(decisionEquity)}</b>
        </div>
        <div>
          <span>CONFIDENCE</span>
          <b>{pct(d.confidence)}</b>
        </div>
      </div>
      {d.fallback ? <p className="warn">{fallbackNotice(d.fallbackKind, d.fallbackReason)}</p> : null}
      {probs ? (
        <ul className="probs" aria-label="option probabilities">
          {probs.map(([id, p]) => (
            <li key={id} className={id === d.optionId ? 'chosen' : ''}>
              <span className="label">{optionName(id)}</span>
              <span className="bar">
                <span style={{ width: `${Math.round((p ?? 0) * 100)}%` }} />
              </span>
              <span className="value">{pct(p)}</span>
            </li>
          ))}
        </ul>
      ) : d.reasoning ? (
        <p className="reasoning">“{d.reasoning}”</p>
      ) : null}
      <footer>
        {shortModel(seat?.model ?? '')} · {ms(d.latencyMs)} · {usd(d.costUsd)}
      </footer>
    </section>
  )
}
