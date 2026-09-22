'use client'
import { characterFor, cueFor, EYE_INK, Mascot } from '@ab/mascot'
import { chips, ms, usd } from '../../lib/format'
import { DECISIONS_PER_SEAT_PER_HAND, estimateGameUsd, estimateSeatUsd, type ModelOption, type SeatChoice } from '../../lib/byo/models'
import { BLINDS, DEFAULT_GAME, filledSeats, HAND_COUNTS, JEV_MODEL, MAX_BUDGET_USD, MAX_HANDS, MIN_BUDGET_USD, PACES, seatId, STACKS, type GameOptions, type Pace } from '../../lib/byo/table'

export interface SetupState {
  seats: SeatChoice[]
  openrouterKey: string
  typesafeKey: string
  remember: boolean
  budgetUsd: number
  game: GameOptions
}

const PACE_NOTE: Record<Pace, string> = { live: 'Live', fast: 'Fast', instant: 'Instant' }

/** What a seat needs before it can play: which key, and whether it is there. */
function keyState(seat: SeatChoice, v: SetupState): { text: string; tone: string } {
  if (seat.kind === 'empty') return { text: '—', tone: 'none' }
  if (seat.kind === 'bot') return { text: 'FREE', tone: 'ok' }
  if (seat.kind === 'jev') return v.typesafeKey ? { text: 'TYPESAFE KEY SET', tone: 'ok' } : { text: 'TYPESAFE KEY NEEDED', tone: 'missing' }
  return v.openrouterKey ? { text: 'OPENROUTER KEY SET', tone: 'ok' } : { text: 'OPENROUTER KEY NEEDED', tone: 'missing' }
}

/** One pill in a row of choices. */
function Pick<T>({ label, on, onPick }: { label: string; on: boolean; onPick: () => void }) {
  return (
    <button type="button" className={`pick${on ? ' on' : ''}`} aria-pressed={on} onClick={onPick}>
      {label}
    </button>
  )
}

/** The form for a table: who sits where, the game, the spending cap, the keys and the estimate. */
export function PlaySetup(props: {
  value: SetupState
  onChange: (next: SetupState) => void
  models: ModelOption[] | null
  modelsError: string | null
  onRetryModels: () => void
  problems: string[]
  onSignIn: () => void
  onForgetKeys: () => void
  onStart: () => void
}) {
  const { value: v, onChange } = props
  const byId = new Map((props.models ?? []).map((m) => [m.id, m]))
  const setSeat = (i: number, seat: SeatChoice) => onChange({ ...v, seats: v.seats.map((s, j) => (j === i ? seat : s)) })
  const setGame = (game: Partial<GameOptions>) => onChange({ ...v, game: { ...v.game, ...game } })
  const playing = filledSeats(v.seats)
  const hands = v.game.hands ?? MAX_HANDS
  const estimate = estimateGameUsd(v.seats, byId, hands)
  const paid = playing
    .map(({ seat, index }) => ({ name: characterFor(seatId(seat, index), index).name, usd: estimateSeatUsd(seat, byId, hands) }))
    .filter((s) => s.usd > 0)
    .sort((a, b) => b.usd - a.usd)
  const decisionsPerHand = playing.length * DECISIONS_PER_SEAT_PER_HAND
  // A model answers in a second or two; bots answer at once. The pace is the pause after each event.
  const thinking = playing.filter(({ seat }) => seat.kind !== 'bot').length * DECISIONS_PER_SEAT_PER_HAND * 2000
  const runTimeMs = hands * (thinking + decisionsPerHand * PACES[v.game.pace])
  const needsJev = v.seats.some((s) => s.kind === 'jev')
  const needsOpenRouter = v.seats.some((s) => s.kind === 'llm')

  return (
    <form
      className="play"
      onSubmit={(e) => {
        e.preventDefault()
        props.onStart()
      }}
    >
      <header className="play-head">
        <span className="kicker">RUN A TABLE</span>
        <h1>Deal your own line-up, with your own keys</h1>
        <p className="lede">
          The table runs in this browser tab. Your API keys stay on this device, are never sent to our server (except Jev&apos;s calls, which pass through a
          relay), and the game stops the moment you close the tab or hit the budget cap.
        </p>
      </header>

      <div className="play-cols">
        <div className="play-main">
          <section className="panel">
            <h2>
              <span className="step">1</span> THE LINE-UP <small>Pick a model per seat. Leave a seat empty to play short-handed.</small>
            </h2>
            {v.seats.map((s, i) => {
              const who = characterFor(seatId(s, i), i)
              const key = keyState(s, v)
              return (
                <div className={`line-up-row${s.kind === 'empty' ? ' empty' : ''}`} key={i} style={{ '--seat': who.color } as React.CSSProperties}>
                  <Mascot shape={who.shape} cue={cueFor('waiting')} size={34} ink={who.color} paper={EYE_INK} frozenAt={99} />
                  <div className="who">
                    <b>{s.kind === 'empty' ? 'EMPTY' : who.name}</b>
                    <small>SEAT {i + 1}</small>
                  </div>
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
                    <option value="empty">Empty seat</option>
                  </select>
                  {s.kind === 'llm' ? (
                    <input
                      aria-label={`seat ${i + 1} model`}
                      list="play-models"
                      value={s.model}
                      placeholder="search models…"
                      onChange={(e) => setSeat(i, { kind: 'llm', model: e.target.value })}
                    />
                  ) : (
                    <span className="seat-note">{s.kind === 'jev' ? `${JEV_MODEL} · TypeSafe` : s.kind === 'bot' ? 'Plays by simple rules, costs nothing' : 'No one in this seat'}</span>
                  )}
                  <span className={`key-state ${key.tone}`}>{key.text}</span>
                </div>
              )
            })}
            <datalist id="play-models">
              {(props.models ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {`${m.featured ? '★ ' : ''}${m.name} · ${usd(m.decisionUsd)}/decision`}
                </option>
              ))}
            </datalist>
            {props.modelsError ? (
              <p className="warn">
                Couldn&apos;t load OpenRouter&apos;s model list ({props.modelsError}).{' '}
                <button type="button" onClick={props.onRetryModels}>
                  Retry
                </button>
              </p>
            ) : null}
            {props.models === null && !props.modelsError ? <p className="muted">Loading OpenRouter&apos;s models…</p> : null}
          </section>

          <section className="panel">
            <h2>
              <span className="step">2</span> THE GAME
            </h2>
            <div className="settings">
              <div>
                <span className="k">BLINDS</span>
                <div className="picks">
                  {BLINDS.map((b) => (
                    <Pick key={b.bigBlind} label={`${chips(b.smallBlind)}/${chips(b.bigBlind)}`} on={v.game.bigBlind === b.bigBlind} onPick={() => setGame({ ...b })} />
                  ))}
                </div>
                <small>Doubles every 10 hands</small>
              </div>
              <div>
                <span className="k">STARTING STACK</span>
                <div className="picks">
                  {STACKS.map((stack) => (
                    <Pick key={stack} label={chips(stack)} on={v.game.startingStack === stack} onPick={() => setGame({ startingStack: stack })} />
                  ))}
                </div>
                <small>Same for every seat</small>
              </div>
              <div>
                <span className="k">PACE</span>
                <div className="picks">
                  {(Object.keys(PACES) as Pace[]).map((pace) => (
                    <Pick key={pace} label={PACE_NOTE[pace]} on={v.game.pace === pace} onPick={() => setGame({ pace })} />
                  ))}
                </div>
                <small>How long between decisions</small>
              </div>
              <div>
                <span className="k">HANDS</span>
                <div className="picks">
                  {HAND_COUNTS.map((count) => (
                    <Pick key={String(count)} label={count === null ? 'Until one seat is left' : String(count)} on={v.game.hands === count} onPick={() => setGame({ hands: count })} />
                  ))}
                </div>
                <small>Stops automatically at the end</small>
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>
              <span className="step">3</span> BUDGET CAP
            </h2>
            <div className="budget">
              <input
                aria-label="spending cap"
                type="range"
                min={MIN_BUDGET_USD}
                max={MAX_BUDGET_USD}
                step="0.1"
                value={v.budgetUsd}
                onChange={(e) => onChange({ ...v, budgetUsd: Number(e.target.value) })}
              />
              <b>{usd(v.budgetUsd)}</b>
            </div>
            <small>
              The game stops when the seats have spent this much. It can go slightly over: the last decision, and calls that time out are counted at their
              estimated price.
            </small>
          </section>
        </div>

        <aside className="play-side">
          <section className="panel estimate">
            <h2>ESTIMATE</h2>
            <b className="big">≈ {usd(estimate)}</b>
            <small>
              for {v.game.hands === null ? `up to ${MAX_HANDS}` : v.game.hands} hands with this line-up (a game often ends sooner, once one seat has the chips)
            </small>
            <dl>
              <div>
                <dt>Decisions per hand</dt>
                <dd>≈ {Math.round(decisionsPerHand)}</dd>
              </div>
              <div>
                <dt>Most expensive seat</dt>
                <dd>{paid[0] ? `${paid[0].name} · ${usd(paid[0].usd)}` : 'free table'}</dd>
              </div>
              <div>
                <dt>Cheapest paid seat</dt>
                <dd>{paid.at(-1) ? `${paid.at(-1)!.name} · ${usd(paid.at(-1)!.usd)}` : '—'}</dd>
              </div>
              <div>
                <dt>Expected run time</dt>
                <dd>{runTimeMs >= 90_000 ? `${Math.round(runTimeMs / 60_000)} min` : ms(runTimeMs)}</dd>
              </div>
            </dl>
            {props.problems.length ? (
              <ul className="problems">
                {props.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : null}
            <button type="submit" className="start" disabled={props.problems.length > 0}>
              Deal the first hand
            </button>
            <small className="centred">You can stop after any hand. Chips are play money.</small>
          </section>

          <section className="panel keys">
            <h2>YOUR KEYS</h2>
            {needsOpenRouter ? (
              <div className="key-row">
                <span className="k">OPENROUTER</span>
                <button type="button" onClick={props.onSignIn}>
                  Sign in with OpenRouter
                </button>
                <input aria-label="OpenRouter key" type="password" autoComplete="off" placeholder="or paste a key: sk-or-…" value={v.openrouterKey} onChange={(e) => onChange({ ...v, openrouterKey: e.target.value.trim() })} />
              </div>
            ) : null}
            {needsJev ? (
              <div className="key-row">
                <span className="k">TYPESAFE</span>
                <input aria-label="TypeSafe key" type="password" autoComplete="off" placeholder="TypeSafe API key" value={v.typesafeKey} onChange={(e) => onChange({ ...v, typesafeKey: e.target.value.trim() })} />
              </div>
            ) : null}
            {!needsJev && !needsOpenRouter ? <p className="muted">This line-up is free: no keys needed.</p> : null}
            <label className="remember">
              <input type="checkbox" checked={v.remember} onChange={(e) => onChange({ ...v, remember: e.target.checked })} /> Remember my keys on this device
            </label>{' '}
            {v.openrouterKey || v.typesafeKey ? (
              <button type="button" onClick={props.onForgetKeys}>
                Forget my keys
              </button>
            ) : null}
          </section>

          <section className="panel notes">
            <h2>WHERE YOUR KEYS GO</h2>
            <ul>
              <li>Model calls go straight from your browser to OpenRouter. Your key never reaches our server.</li>
              <li>
                Jev&apos;s calls pass through a thin relay on our server, because TypeSafe doesn&apos;t accept calls from web pages yet. The relay forwards your
                key with each call and never stores or logs it.
              </li>
              <li>Keys are held in this tab only, unless you ask to be remembered on this device.</li>
              <li>The budget cap is checked before every decision, so a runaway game stops itself.</li>
            </ul>
          </section>
        </aside>
      </div>
    </form>
  )
}

export { DEFAULT_GAME }
