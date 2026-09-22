'use client'
import { characterFor } from '@ab/mascot'
import { usd } from '../../lib/format'
import { DECISIONS_PER_SEAT, estimateGameUsd, type ModelOption, type SeatChoice } from '../../lib/byo/models'
import { MAX_BUDGET_USD, MIN_BUDGET_USD, seatId } from '../../lib/byo/table'

export interface SetupState {
  seats: SeatChoice[]
  openrouterKey: string
  typesafeKey: string
  remember: boolean
  budgetUsd: number
}

/** The form for a table: who sits where, the visitor's keys, the spending cap and the cost estimate. */
export function PlaySetup(props: {
  value: SetupState
  onChange: (next: SetupState) => void
  models: ModelOption[] | null
  modelsError: string | null
  problems: string[]
  onSignIn: () => void
  onStart: () => void
}) {
  const { value: v, onChange } = props
  const byId = new Map((props.models ?? []).map((m) => [m.id, m]))
  const setSeat = (i: number, seat: SeatChoice) => onChange({ ...v, seats: v.seats.map((s, j) => (j === i ? seat : s)) })
  const needsJev = v.seats.some((s) => s.kind === 'jev')
  const needsOpenRouter = v.seats.some((s) => s.kind === 'llm')
  const estimate = estimateGameUsd(v.seats, byId)

  return (
    <form
      className="play-setup"
      onSubmit={(e) => {
        e.preventDefault()
        props.onStart()
      }}
    >
      <h1>Run your own table</h1>
      <p className="lede">
        Seat any models you like and watch them play a turbo tournament. The game runs in this browser with your own keys; you pay the providers directly.
      </p>

      <fieldset>
        <legend>Players</legend>
        {v.seats.map((s, i) => (
          <div className="seat-choice" key={i}>
            <b>{characterFor(seatId(s, i), i).name}</b>
            <select
              aria-label={`seat ${i + 1} player`}
              value={s.kind}
              onChange={(e) => {
                const kind = e.target.value as SeatChoice['kind']
                setSeat(i, kind === 'llm' ? { kind, model: props.models?.[0]?.id ?? '' } : { kind })
              }}
            >
              {i === 0 ? <option value="jev">Jev (TypeSafe)</option> : null}
              <option value="llm">A model (OpenRouter)</option>
              <option value="bot">Free bot</option>
            </select>
            {s.kind === 'llm' ? (
              <>
                <input
                  aria-label={`seat ${i + 1} model`}
                  list="play-models"
                  value={s.model}
                  placeholder="search models…"
                  onChange={(e) => setSeat(i, { kind: 'llm', model: e.target.value.trim() })}
                />
                <small>{byId.get(s.model) ? `≈ ${usd(byId.get(s.model)!.decisionUsd)} a decision` : 'pick from the list'}</small>
              </>
            ) : null}
          </div>
        ))}
        <datalist id="play-models">
          {(props.models ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {`${m.featured ? '★ ' : ''}${m.name} · ${usd(m.decisionUsd)}/decision`}
            </option>
          ))}
        </datalist>
        {props.modelsError ? <p className="warn">Couldn't load OpenRouter's model list: {props.modelsError}</p> : null}
        {props.models === null && !props.modelsError ? <p className="muted">Loading OpenRouter's models…</p> : null}
      </fieldset>

      {needsOpenRouter ? (
        <fieldset>
          <legend>OpenRouter (the model seats)</legend>
          <button type="button" onClick={props.onSignIn}>
            Sign in with OpenRouter
          </button>{' '}
          <span className="muted">or paste a key:</span>{' '}
          <input aria-label="OpenRouter key" type="password" autoComplete="off" placeholder="sk-or-…" value={v.openrouterKey} onChange={(e) => onChange({ ...v, openrouterKey: e.target.value.trim() })} />
          {v.openrouterKey ? <span className="ok"> ✓ connected</span> : null}
        </fieldset>
      ) : null}

      {needsJev ? (
        <fieldset>
          <legend>TypeSafe (the Jev seat)</legend>
          <input aria-label="TypeSafe key" type="password" autoComplete="off" placeholder="TypeSafe API key" value={v.typesafeKey} onChange={(e) => onChange({ ...v, typesafeKey: e.target.value.trim() })} />
          <p className="notice">
            Relayed: TypeSafe doesn't accept calls from web pages yet, so Jev's requests pass through our server, which forwards your key to TypeSafe with each
            call and never stores or logs it. Model seats talk to OpenRouter directly.
          </p>
        </fieldset>
      ) : null}

      <fieldset>
        <legend>Spending</legend>
        <label>
          Stop the game at ${' '}
          <input
            aria-label="spending cap"
            type="number"
            min={MIN_BUDGET_USD}
            max={MAX_BUDGET_USD}
            step="0.1"
            value={v.budgetUsd}
            onChange={(e) => onChange({ ...v, budgetUsd: Number(e.target.value) })}
          />
        </label>
        <p className="estimate">
          Estimated cost ≈ <b>{usd(estimate)}</b> for a whole game (up to {DECISIONS_PER_SEAT} decisions a seat). It never goes past your cap.
        </p>
        <label className="remember">
          <input type="checkbox" checked={v.remember} onChange={(e) => onChange({ ...v, remember: e.target.checked })} /> Remember my keys on this device
        </label>
      </fieldset>

      {props.problems.length ? (
        <ul className="problems">
          {props.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      <button type="submit" className="start" disabled={props.problems.length > 0}>
        Start the game
      </button>
    </form>
  )
}
