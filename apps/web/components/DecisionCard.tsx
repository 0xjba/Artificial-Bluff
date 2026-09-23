'use client'
import type { TableView } from '@ab/core/view'
import { characterFor } from '@ab/mascot'
import { MascotBadge } from './MascotBadge'
import { fallbackNotice, ms, pct, positionName, shortAction, shortModel, usd } from '../lib/format'

const optionName = (id: string) => id.replace(/_/g, ' ').replace(/\b(\d)(\d)bb\b/, '$1.$2bb')

/**
 * The last decision: who acted, what they did, the chance they gave themselves against the true
 * chance, and how sure they were. Jev answers with a probability for every option, so it shows those
 * bars; the LLMs write a line of reasoning instead.
 *
 * Changes for phones (the CSS half lives in the phone media queries of globals.css):
 * - the mascot and seat position identify who acted, and the move reads as a pill, so the card has
 *   a subject at a glance rather than a name in running text;
 * - the claimed chance and the measured one each carry a bar, so the gap between them is visible
 *   before either number is read;
 * - the footer carries three labelled cells instead of one run-on line, which the phone rules lay
 *   out as a row of cells.
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
  const index = view.seats.findIndex((s) => s.playerId === d.playerId)
  const seat = view.seats[index]
  const who = characterFor(d.playerId, index)
  // Jev answers with a probability for every option, so its confidence is not the LLMs' number.
  const jev = seat?.kind === 'jev'
  const entries = d.optionProbabilities ? Object.entries(d.optionProbabilities) : []
  const probs = entries.length ? entries.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 5) : null
  const position = positionName(seat?.position ?? null)
  // The hand this decision belongs to, named in the panel header.
  const handNo = view.hand && !view.hand.ended ? view.handsPlayed + 1 : view.handsPlayed
  const handMeta = view.hand ? `HAND ${handNo} · ${view.hand.street.toUpperCase()}` : null
  const width = (p: number | null | undefined) => `${Math.round(Math.min(1, Math.max(0, p ?? 0)) * 100)}%`
  return (
    <section className="decision" style={{ '--seat': who.color } as React.CSSProperties}>
      {/* Screen readers hear one short line per decision, not the whole panel. */}
      <span className="sr-only" aria-live="polite">{`${who.name}: ${d.label}`}</span>
      <h2>
        LAST DECISION
        {handMeta ? <small>{handMeta}</small> : null}
      </h2>
        <p className="who-did">
        <span className="who-mascot" aria-hidden="true">
          <MascotBadge playerId={d.playerId} index={index} size={32} />
        </span>
        <span className="who-id">
          <b>{who.name}</b>
          {position ? <small>{position}</small> : null}
        </span>
        <span className="action">{shortAction(d.label)}</span>
      </p>
      <div className="claims">
        <div title="The chance of winning this hand that the player claimed, just before it acted.">
          <span>AI SAID</span>
          <b>{pct(d.winProbability)}</b>
          {/* The two claims are read against each other, so each carries its own bar. */}
          <span className="claim-bar said" aria-hidden="true">
            <span style={{ width: width(d.winProbability) }} />
          </span>
          <small>its own guess at winning</small>
        </div>
        <div title={jev ? "How much of Jev's probability sat on the option it chose." : 'How sure the player said it was that this was the right move.'}>
          <span>AI CONFIDENCE</span>
          <b>{pct(d.confidence)}</b>
          <small>{jev ? 'weight on this option' : 'how sure it was of the move'}</small>
        </div>
        <div title="Arithmetic, not opinion: the share of the ways the remaining cards can fall in which this player wins the pot, given every hand at the table. Sampled when there are too many to count one by one.">
          <span>REALITY</span>
          <b className="true">{pct(decisionEquity)}</b>
          <span className="claim-bar real" aria-hidden="true">
            <span style={{ width: width(decisionEquity) }} />
          </span>
          <small>its real odds, once every hand is seen</small>
        </div>
      </div>
      {d.fallback ? <p className="warn">{fallbackNotice(d.fallbackKind, d.fallbackReason)}</p> : null}
      {/* Both, when a player gives both: Jev's option weights and any line it wrote. */}
      {probs ? (
        <ul className="probs" aria-label="option probabilities">
          {probs.map(([id, p]) => (
            <li key={id} className={id === d.optionId ? 'chosen' : ''}>
              <span className="label">{optionName(id)}</span>
              <span className="bar">
                <span style={{ width: width(p) }} />
              </span>
              <span className="value">{pct(p)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {d.reasoning ? <p className="reasoning">“{d.reasoning}”</p> : null}
      {/* Three cells, labelled for THIS move: the players panel shows each seat's running
          averages, so these have to say they are the one decision above. */}
      <footer>
        <span>
          <small>ANSWERED BY</small>
          {shortModel(seat?.model ?? '')}
        </span>
        <span>
          <small>THIS MOVE TOOK</small>
          {ms(d.latencyMs)}
        </span>
        <span>
          <small>THIS MOVE COST</small>
          {usd(d.costUsd)}
        </span>
      </footer>
    </section>
  )
}
