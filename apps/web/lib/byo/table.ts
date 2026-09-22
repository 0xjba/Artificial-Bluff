import { applyEvent, emptyView, equityKey, MemoryStore, runTournamentGame, tableEquity, withEquity, type GameEvent, type GameStore } from '@ab/core/browser'
import type { BlindLevel, TournamentConfig } from '@ab/engine'
import { adaptLineup, JevPlayer, LlmPlayer, TagBot, type CatalogModel, type Player, type PlayerSpec } from '@ab/players'
import type { Channel, FeedMessage } from '@ab/server'
import { jevDecisionUsd, MAX_DECISION_USD, type ModelOption, type SeatChoice } from './models'

/** Seat ids (the on-screen characters). Seat 0 is JEV when Jev plays it, PEBBLE otherwise. */
export const SEAT_IDS = ['jev', 'pill', 'block', 'drip', 'nimbus'] as const
export const JEV_MODEL = 'jev-1.13.0'
export const DEFAULT_SEATS: SeatChoice[] = [
  { kind: 'jev' },
  { kind: 'llm', model: 'anthropic/claude-sonnet-5' },
  { kind: 'llm', model: 'openai/gpt-5.6-sol' },
  { kind: 'llm', model: 'google/gemini-3.8-flash' },
  { kind: 'llm', model: 'meta-llama/llama-4-maverick' },
]
export const MIN_BUDGET_USD = 0.1
export const MAX_BUDGET_USD = 20
export const DECISION_TIMEOUT_MS = 20_000
/** Pause after each event, so viewers can follow bots and fast models. */
export const TABLE_PACE_MS = 900
/** How fast the table plays: the pause after each event. */
export const PACES = { live: 900, fast: 300, instant: 0 } as const
export type Pace = keyof typeof PACES
/** Blinds a table can start at; they double every BLIND_LEVEL_HANDS hands. */
export const BLINDS = [
  { smallBlind: 50, bigBlind: 100 },
  { smallBlind: 100, bigBlind: 200 },
  { smallBlind: 250, bigBlind: 500 },
] as const
export const STACKS = [10_000, 20_000] as const
/** Hand counts a table can stop at; `null` plays until one seat is left (capped at MAX_HANDS). */
export const HAND_COUNTS = [20, 40, null] as const
export const MAX_HANDS = 200
export const BLIND_LEVEL_HANDS = 10
/** The smallest table: two seats. */
export const MIN_SEATS = 2

export interface GameOptions {
  smallBlind: number
  bigBlind: number
  startingStack: number
  /** Hands to play, or null to play until one seat is left. */
  hands: number | null
  pace: Pace
}

export const DEFAULT_GAME: GameOptions = { smallBlind: 100, bigBlind: 200, startingStack: 10_000, hands: 40, pace: 'live' }

/** Blind levels for a table: the chosen blinds, doubling each level. */
export function blindLevels(smallBlind: number, bigBlind: number, levels = 8): BlindLevel[] {
  return Array.from({ length: levels }, (_, i) => ({ smallBlind: smallBlind * 2 ** i, bigBlind: bigBlind * 2 ** i }))
}

/** The tournament a table plays. */
export function tournamentFor(game: GameOptions, seed: string): TournamentConfig {
  return {
    startingStack: game.startingStack,
    levels: blindLevels(game.smallBlind, game.bigBlind),
    handsPerLevel: BLIND_LEVEL_HANDS,
    maxHands: game.hands ?? MAX_HANDS,
    seed,
  }
}

export const seatId = (seat: SeatChoice, index: number): string => (index === 0 && seat.kind !== 'jev' ? 'pebble' : SEAT_IDS[index]!)

/** The seats that actually play (empty ones are left out). */
export const filledSeats = (seats: SeatChoice[]) => seats.map((seat, index) => ({ seat, index })).filter(({ seat }) => seat.kind !== 'empty')

export interface TableSetup {
  seats: SeatChoice[]
  openrouterKey: string | null
  typesafeKey: string | null
  budgetUsd: number
  game: GameOptions
}

export interface TableDeps {
  /** OpenRouter's catalog entries by id (for each model's request settings). */
  catalog: Map<string, CatalogModel>
  /** Supported models by id (their estimated price counts a timed-out decision against the cap). */
  models: Map<string, ModelOption>
  /** Base URL of our TypeSafe relay, e.g. `${location.origin}/api/typesafe`. */
  relayBase: string
  /** This site, sent to OpenRouter as the app's referer. */
  referer: string
  fetch?: typeof fetch
  seed?: string
  paceMs?: number
  decisionTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

/** What stops a table from starting, in plain words (empty when it can start). */
export function checkSetup(setup: TableSetup, models: Map<string, ModelOption>): string[] {
  const problems: string[] = []
  const playing = filledSeats(setup.seats)
  if (setup.seats.length > SEAT_IDS.length) problems.push(`a table has at most ${SEAT_IDS.length} seats`)
  if (playing.length < MIN_SEATS) problems.push(`fill at least ${MIN_SEATS} seats`)
  setup.seats.forEach((s, i) => {
    if (s.kind === 'jev' && i !== 0) problems.push('Jev can only play the first seat')
    if (s.kind === 'llm' && !models.has(s.model.trim())) problems.push(`seat ${i + 1}: choose a model from the list`)
  })
  if (setup.seats.some((s) => s.kind === 'llm') && !setup.openrouterKey) problems.push('connect OpenRouter (or paste a key) for the model seats')
  if (setup.seats.some((s) => s.kind === 'jev') && !setup.typesafeKey) problems.push('add a TypeSafe key for the Jev seat')
  if (!(setup.budgetUsd >= MIN_BUDGET_USD && setup.budgetUsd <= MAX_BUDGET_USD)) problems.push(`the spending cap must be between $${MIN_BUDGET_USD} and $${MAX_BUDGET_USD}`)
  return problems
}

/** The players for a checked setup: Jev through our relay, models straight to OpenRouter, bots free. */
export function buildPlayers(setup: TableSetup, deps: TableDeps): Player[] {
  const specs: PlayerSpec[] = filledSeats(setup.seats).map(({ seat, index }): PlayerSpec => {
    const id = seatId(seat, index)
    if (seat.kind === 'jev') return { id, kind: 'jev', model: JEV_MODEL }
    if (seat.kind === 'llm') return { id, kind: 'llm', model: seat.model.trim() }
    return { id, kind: 'bot', bot: 'tag' }
  })
  const { specs: adapted } = adaptLineup(specs, deps.catalog)
  const fetchOpt = deps.fetch ? { fetch: deps.fetch } : {}
  return adapted.map((spec): Player => {
    if (spec.kind === 'jev') {
      return new JevPlayer({ id: spec.id, model: spec.model, client: { apiKey: setup.typesafeKey!, baseURL: deps.relayBase, dangerouslyAllowBrowser: true, ...fetchOpt } })
    }
    if (spec.kind === 'llm') {
      return new LlmPlayer({
        id: spec.id,
        model: spec.model,
        openrouter: { apiKey: setup.openrouterKey!, referer: deps.referer, title: 'artificialBluff', ...fetchOpt },
        ...(spec.reasoning !== undefined ? { reasoning: spec.reasoning } : {}),
        ...(spec.structuredOutput !== undefined ? { structuredOutput: spec.structuredOutput } : {}),
        ...(spec.sendTemperature !== undefined ? { sendTemperature: spec.sendTemperature } : {}),
      })
    }
    return new TagBot(spec.id)
  })
}

const randomSeed = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')

/**
 * A turbo tournament played in this browser. It sends the same messages as the live server's feed (a
 * snapshot, then events and equity), so the page shows it with the usual broadcast screen. Stopping
 * lets the hand in progress finish; the spending cap ends the game once reached.
 */
export class LocalTable {
  readonly gameId = `table-${Date.now()}`
  readonly channel: Channel = { id: `local-${this.gameId}`, mode: 'live', title: 'Your table', gameId: this.gameId }
  readonly #store = new MemoryStore()
  readonly #abort = new AbortController()
  #view = emptyView()
  #equityKey: string | null = null
  /**
   * Estimated cost of paid decisions that timed out: the provider may still bill them but reports
   * nothing, so the cap counts them at the model's estimated price (else a slow model could overspend
   * without limit).
   */
  #unrecordedUsd = 0
  /** The store the game runs on: the memory store, with unrecorded cost added to what it has spent. */
  readonly #gameStore: GameStore = {
    createGame: (id, kind, config) => this.#store.createGame(id, kind, config),
    sink: (id) => this.#store.sink(id),
    setStatus: (id, status) => this.#store.setStatus(id, status),
    gameCost: (id) => this.#store.gameCost(id) + this.#unrecordedUsd,
  }

  constructor(
    readonly setup: TableSetup,
    readonly deps: TableDeps,
    readonly onMessage: (m: FeedMessage) => void,
  ) {}

  /** Plays the game to its end; resolves with how it ended. */
  async start(): Promise<'ended' | 'interrupted'> {
    this.onMessage({ type: 'snapshot', channel: this.channel, view: this.#view })
    await runTournamentGame({
      gameId: this.gameId,
      players: buildPlayers(this.setup, this.deps),
      tournament: tournamentFor(this.setup.game, this.deps.seed ?? randomSeed()),
      store: this.#gameStore,
      decisionTimeoutMs: this.deps.decisionTimeoutMs ?? DECISION_TIMEOUT_MS,
      paceMs: this.deps.paceMs ?? PACES[this.setup.game.pace],
      budgetUsd: this.setup.budgetUsd,
      signal: this.#abort.signal,
      meta: { source: 'browser-table' },
      onEvent: (e) => this.#publish(e),
      ...(this.deps.sleep ? { sleep: this.deps.sleep } : {}),
    })
    return this.#store.status(this.gameId) === 'ended' ? 'ended' : 'interrupted'
  }

  /** Ends the game after the hand in progress. */
  stop(): void {
    this.#abort.abort()
  }

  /** Spent so far by all seats (USD), counting timed-out paid decisions at their estimated price. */
  spentUsd(): number {
    return this.#store.gameCost(this.gameId) + this.#unrecordedUsd
  }

  /** Estimated price of one decision by a seat (the dearest allowed model if unknown; 0 for bots). */
  #decisionUsd(playerId: string): number {
    const seat = this.setup.seats.find((s, i) => s.kind !== 'empty' && seatId(s, i) === playerId)
    if (seat?.kind === 'jev') return jevDecisionUsd()
    if (seat?.kind === 'llm') return this.deps.models.get(seat.model)?.decisionUsd ?? MAX_DECISION_USD
    return 0
  }

  // Same as the live server's hub: equity is recomputed when the board or the players still in change.
  #publish(event: GameEvent): void {
    if (event.type === 'decision' && event.fallbackKind === 'timeout') this.#unrecordedUsd += this.#decisionUsd(event.playerId)
    this.#view = applyEvent(this.#view, event)
    this.onMessage({ type: 'event', channelId: this.channel.id, event })
    const key = equityKey(this.#view)
    if (key === this.#equityKey) return
    this.#equityKey = key
    if (key === null) return
    const result = tableEquity(this.#view)
    this.#view = withEquity(this.#view, result?.equity ?? null, result?.estimated ?? false)
    this.onMessage({ type: 'equity', channelId: this.channel.id, handId: this.#view.hand?.handId ?? null, equity: this.#view.equity, estimated: this.#view.equityEstimated })
  }
}
