'use client'
import { characterFor, cueFor, EYE_INK, Mascot } from '@ab/mascot'
import { chips, usd } from '../../lib/format'
import { DECISIONS_PER_SEAT_PER_HAND, estimateGameUsd, estimateSeatUsd, type ModelOption, type SeatChoice } from '../../lib/byo/models'
import styles from './run.module.css'
import { BLINDS, DEFAULT_GAME, filledSeats, HAND_COUNTS, JEV_MODEL, MAX_BUDGET_USD, MAX_HANDS, MIN_BUDGET_USD, PACES, seatId, STACKS, type GameOptions, type Pace } from '../../lib/byo/table'

export interface SetupState {
  seats: SeatChoice[]
  openrouterKey: string
  typesafeKey: string
  remember: boolean
  budgetUsd: number
  game: GameOptions
}

const PACE_LABEL: Record<Pace, string> = { live: 'Live', fast: 'Fast', instant: 'Instant' }

/** What a seat is waiting for, shown at the end of its row. */
function keyState(seat: SeatChoice, v: SetupState): { text: string; tone: string } {
  if (seat.kind === 'empty') return { text: '—', tone: 'none' }
  if (seat.kind === 'bot') return { text: 'FREE SEAT', tone: 'ok' }
  if (seat.kind === 'jev') return v.typesafeKey ? { text: 'KEY SET', tone: 'ok' } : { text: 'KEY NEEDED', tone: 'missing' }
  return v.openrouterKey ? { text: 'KEY SET', tone: 'ok' } : { text: 'KEY NEEDED', tone: 'missing' }
}

/** What the seat's control shows when it is closed. */
function seatLabel(seat: SeatChoice, models: Map<string, ModelOption>): { text: string; muted: boolean } {
  if (seat.kind === 'jev') return { text: `${JEV_MODEL} · TypeSafe`, muted: false }
  if (seat.kind === 'bot') return { text: 'Free bot · plays by simple rules', muted: false }
  if (seat.kind === 'empty') return { text: 'Empty seat', muted: true }
  const model = models.get(seat.model.trim())
  return model ? { text: `${model.id} · ${usd(model.decisionUsd)} a decision`, muted: false } : { text: seat.model || 'Pick a model', muted: true }
}

/** The value of a seat's control: its kind, or the model id when a model plays it. */
const seatValue = (seat: SeatChoice) => (seat.kind === 'llm' ? seat.model : seat.kind)

/** One choice row: the label, the pills, and a note under them. */
function Setting({ label, note, children }: { label: string; note: string; children: React.ReactNode }) {
  return (
    <div className={styles.setting}>
      <span className={styles.k}>{label}</span>
      <div className={styles.picks}>{children}</div>
      <span className={styles.note}>{note}</span>
    </div>
  )
}

function Pick({ label, on, onPick }: { label: string; on: boolean; onPick: () => void }) {
  return (
    <button type="button" className={`${styles.pick}${on ? ` ${styles.on}` : ''}`} aria-pressed={on} onClick={onPick}>
      {label}
    </button>
  )
}

/** Run a table: the line-up, the game, the budget cap, your keys and the estimate. */
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
  const models = props.models ?? []
  const byId = new Map(models.map((m) => [m.id, m]))
  const featured = models.filter((m) => m.featured)
  const rest = models.filter((m) => !m.featured)
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
  // Models take a second or two to answer; bots answer at once. The pace adds a pause after each event.
  const thinkingMs = playing.filter(({ seat }) => seat.kind !== 'bot').length * DECISIONS_PER_SEAT_PER_HAND * 2000
  const runTimeMin = Math.max(1, Math.round((hands * (thinkingMs + decisionsPerHand * PACES[v.game.pace])) / 60_000))
  const needsJev = v.seats.some((s) => s.kind === 'jev')
  const needsOpenRouter = v.seats.some((s) => s.kind === 'llm')
  const capPercent = ((v.budgetUsd - MIN_BUDGET_USD) / (MAX_BUDGET_USD - MIN_BUDGET_USD)) * 100

  const estimateRows: Array<[string, string]> = [
    ['Decisions per hand', `≈ ${Math.round(decisionsPerHand)}`],
    ['Most expensive seat', paid[0] ? `${paid[0].name} · ${usd(paid[0].usd)}` : 'free table'],
    ['Cheapest paid seat', paid.at(-1) ? `${paid.at(-1)!.name} · ${usd(paid.at(-1)!.usd)}` : '—'],
    ['Expected run time', `${runTimeMin} min`],
  ]

  return (
    <form
      className={styles.run}
      onSubmit={(e) => {
        e.preventDefault()
        props.onStart()
      }}
    >
      <header className={styles['run-head']}>
        <span className={styles.kicker}>RUN A TABLE</span>
        <h1>Deal your own line-up, with your own keys</h1>
        <p>
          The table runs in this browser tab. Your API keys stay on this device and are never stored on our server (Jev&apos;s calls pass through a relay that
          forwards your key and keeps nothing), and the game stops the moment you close the tab or hit the budget cap.
        </p>
      </header>

      <div className={styles['run-cols']}>
        <div className={styles['run-main']}>
          <section className={styles['run-panel']}>
            <div className={styles['run-panel-head']}>
              <span className={styles.k}>1 · THE LINE-UP</span>
              <span className={styles.hint}>Pick a model per seat. Leave a seat empty to play short-handed.</span>
            </div>
            {v.seats.map((s, i) => {
              const who = characterFor(seatId(s, i), i)
              const key = keyState(s, v)
              const label = seatLabel(s, byId)
              return (
                <div className={styles['seat-row']} key={i}>
                  <span className={styles['seat-mascot']}>
                    <Mascot shape={who.shape} cue={cueFor('waiting')} size={36} ink={who.color} paper={EYE_INK} frozenAt={99} />
                  </span>
                  <span className={styles['seat-name']}>
                    <b>{s.kind === 'empty' ? 'EMPTY' : who.name}</b>
                    <small>SEAT {i + 1}</small>
                  </span>
                  <span className={styles['seat-pick']}>
                    <span className={`${styles['seat-model']}${label.muted ? ` ${styles.muted}` : ''}`}>{label.text}</span>
                    <span className={styles.change}>CHANGE ▾</span>
                    <select
                      aria-label={`seat ${i + 1} player`}
                      value={seatValue(s)}
                      onChange={(e) => {
                        const value = e.target.value
                        setSeat(i, value === 'jev' || value === 'bot' || value === 'empty' ? { kind: value } : { kind: 'llm', model: value })
                      }}
                    >
                      <optgroup label="This seat">
                        {i === 0 ? <option value="jev">Jev · TypeSafe</option> : null}
                        <option value="bot">Free bot</option>
                        <option value="empty">Empty seat</option>
                      </optgroup>
                      {featured.length ? (
                        <optgroup label="Models we use">
                          {featured.map((m) => (
                            <option key={m.id} value={m.id}>
                              {`${m.id} · ${usd(m.decisionUsd)} a decision`}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {rest.length ? (
                        <optgroup label={`Every supported model (${rest.length})`}>
                          {rest.map((m) => (
                            <option key={m.id} value={m.id}>
                              {`${m.id} · ${usd(m.decisionUsd)} a decision`}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </select>
                  </span>
                  <span className={`${styles['seat-key']} ${styles[key.tone] ?? ''}`}>{key.text}</span>
                </div>
              )
            })}
            {props.modelsError ? (
              <div className={`${styles['seat-row']} ${styles['note-row']}`}>
                <span className="warn">
                  Couldn&apos;t load OpenRouter&apos;s model list ({props.modelsError}).{' '}
                  <button type="button" onClick={props.onRetryModels}>
                    Retry
                  </button>
                </span>
              </div>
            ) : null}
            {props.models === null && !props.modelsError ? (
              <div className={`${styles['seat-row']} ${styles['note-row']}`}>
                <span className={styles.hint}>Loading OpenRouter&apos;s models…</span>
              </div>
            ) : null}
          </section>

          <section className={`${styles['run-panel']} ${styles.padded}`}>
            <span className={styles.k}>2 · THE GAME</span>
            <div className={styles.settings}>
              <Setting label="BLINDS" note="Doubles every 10 hands">
                {BLINDS.map((b) => (
                  <Pick key={b.bigBlind} label={`${chips(b.smallBlind)}/${chips(b.bigBlind)}`} on={v.game.bigBlind === b.bigBlind} onPick={() => setGame({ ...b })} />
                ))}
              </Setting>
              <Setting label="STARTING STACK" note="Same for every seat">
                {STACKS.map((stack) => (
                  <Pick key={stack} label={chips(stack)} on={v.game.startingStack === stack} onPick={() => setGame({ startingStack: stack })} />
                ))}
              </Setting>
              <Setting label="PACE" note="How long between decisions">
                {(Object.keys(PACES) as Pace[]).map((pace) => (
                  <Pick key={pace} label={PACE_LABEL[pace]} on={v.game.pace === pace} onPick={() => setGame({ pace })} />
                ))}
              </Setting>
              <Setting label="HANDS" note="Stops automatically at the end">
                {HAND_COUNTS.map((count) => (
                  <Pick
                    key={String(count)}
                    label={count === null ? 'Until one seat is left' : String(count)}
                    on={v.game.hands === count}
                    onPick={() => setGame({ hands: count })}
                  />
                ))}
              </Setting>
            </div>
          </section>

          <section className={`${styles['run-panel']} ${styles.padded}`}>
            <span className={styles.k}>3 · BUDGET CAP</span>
            <div className={styles.budget}>
              <div className={styles['budget-slider']}>
                <div className={styles.track}>
                  <span className={styles.fill} style={{ width: `${capPercent}%` }} />
                  <span className={styles.thumb} style={{ left: `${capPercent}%` }} />
                  <input
                    aria-label="spending cap"
                    type="range"
                    min={MIN_BUDGET_USD}
                    max={MAX_BUDGET_USD}
                    step="0.1"
                    value={v.budgetUsd}
                    onChange={(e) => onChange({ ...v, budgetUsd: Number(e.target.value) })}
                  />
                </div>
                <div className={styles['budget-scale']}>
                  <span>{usd(MIN_BUDGET_USD)}</span>
                  <span>STOPS WHEN REACHED</span>
                  <span>{usd(MAX_BUDGET_USD)}</span>
                </div>
              </div>
              <div className={styles['budget-cap']}>
                <span className={styles.k}>CAP</span>
                <b>{usd(v.budgetUsd)}</b>
              </div>
            </div>
            <p className={styles.note}>
              The game stops once the seats have spent this much. It can go a little over: the decision in flight, and calls that time out are counted at their
              estimated price.
            </p>
          </section>

          <section className={`${styles['run-panel']} ${styles.padded}`}>
            <span className={styles.k}>4 · YOUR KEYS</span>
            {needsOpenRouter ? (
              <div className={styles['key-row']}>
                <span className={styles.k}>OPENROUTER</span>
                <button type="button" className={styles.signin} onClick={props.onSignIn}>
                  Sign in with OpenRouter
                </button>
                <input
                  aria-label="OpenRouter key"
                  type="password"
                  autoComplete="off"
                  placeholder="or paste a key: sk-or-…"
                  value={v.openrouterKey}
                  onChange={(e) => onChange({ ...v, openrouterKey: e.target.value.trim() })}
                />
              </div>
            ) : null}
            {needsJev ? (
              <div className={styles['key-row']}>
                <span className={styles.k}>TYPESAFE</span>
                <input
                  aria-label="TypeSafe key"
                  type="password"
                  autoComplete="off"
                  placeholder="TypeSafe API key, for the Jev seat"
                  value={v.typesafeKey}
                  onChange={(e) => onChange({ ...v, typesafeKey: e.target.value.trim() })}
                />
              </div>
            ) : null}
            {!needsJev && !needsOpenRouter ? <p className={styles.note}>This line-up is free: no keys needed.</p> : null}
            <div className={styles['key-row']}>
              <label className={styles.remember}>
                <input type="checkbox" checked={v.remember} onChange={(e) => onChange({ ...v, remember: e.target.checked })} /> Remember my keys on this device
              </label>
              {v.openrouterKey || v.typesafeKey ? (
                <button type="button" onClick={props.onForgetKeys}>
                  Forget my keys
                </button>
              ) : null}
            </div>
          </section>
        </div>

        <aside className={styles['run-side']}>
          <section className={`${styles['run-panel']} ${styles.padded}`}>
            <span className={styles.k}>ESTIMATE</span>
            <div>
              <div className={styles.big}>≈ {usd(estimate)}</div>
              <div className={styles.hint}>for {v.game.hands === null ? `up to ${MAX_HANDS}` : v.game.hands} hands with this line-up</div>
            </div>
            {estimateRows.map(([k, value]) => (
              <div className={styles['estimate-row']} key={k}>
                <span>{k}</span>
                <b>{value}</b>
              </div>
            ))}
            {props.problems.length ? (
              <ul className={styles.problems}>
                {props.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : null}
            <button type="submit" className={styles.deal} disabled={props.problems.length > 0}>
              Deal the first hand
            </button>
            <span className={`${styles.hint} ${styles.centred}`}>You can stop after any hand. Chips are play money.</span>
          </section>

          <section className={`${styles['run-panel']} ${styles.padded} ${styles.notes}`}>
            <span className={styles.k}>WHERE YOUR KEYS GO</span>
            {[
              'Keys are held in this tab only and cleared when you close it, unless you ask to be remembered on this device.',
              "Model calls go straight from your browser to OpenRouter. TypeSafe doesn't accept calls from web pages yet, so Jev's calls pass through a thin relay that forwards your key and never stores or logs it.",
              'The budget cap is checked before every decision, so a runaway game stops itself.',
            ].map((note) => (
              <div className={styles['note-row']} key={note}>
                <span className={styles.dot} />
                <span>{note}</span>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </form>
  )
}

export { DEFAULT_GAME }
