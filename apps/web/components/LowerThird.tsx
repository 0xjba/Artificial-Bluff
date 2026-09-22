'use client'
import type { TableView } from '@ab/core/view'
import { characterFor } from '@ab/mascot'
import { fallbackNotice, ms, pct, shortModel, usd } from '../lib/format'

const optionName = (id: string) => id.replace(/_/g, ' ').replace(/\b(\d)(\d)bb\b/, '$1.$2bb')

/**
 * The latest decision, as a broadcast lower third: who, what, how sure, and what they said their
 * chances were against the true chances. Jev shows its option probabilities; LLMs their reasoning.
 */
export function LowerThird({ view, decisionEquity }: { view: TableView; decisionEquity: number | null }) {
  const d = view.lastDecision
  if (!d)
    return (
      <section className="lower-third empty">
        Decisions will appear here.
        <span className="sr-only" aria-live="polite" />
      </section>
    )
  const seat = view.seats.find((s) => s.playerId === d.playerId)
  const who = characterFor(d.playerId, view.seats.indexOf(seat!))
  const probs = d.optionProbabilities ? Object.entries(d.optionProbabilities).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 5) : null
  return (
    <section className={`lower-third${seat?.kind === 'jev' ? ' jev' : ''}`}>
      {/* Screen readers hear one short line per decision, not the whole panel. */}
      <span className="sr-only" aria-live="polite">{`${who.name}: ${d.label}`}</span>
      <header>
        <b>{who.name}</b> <span className="badge">{shortModel(seat?.model ?? '')}</span>
        <span className="action">{d.label}</span>
        {d.fallback ? <span className="warn">{fallbackNotice(d.fallbackKind, d.fallbackReason)}</span> : null}
        <span className="stats">
          {ms(d.latencyMs)} · {usd(d.costUsd)}
        </span>
      </header>
      <div className="said">
        <span>
          said <b>{pct(d.winProbability)}</b> to win
        </span>
        <span>
          true <b>{pct(decisionEquity)}</b>
        </span>
        <span>
          confidence <b>{pct(d.confidence)}</b>
        </span>
      </div>
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
    </section>
  )
}
