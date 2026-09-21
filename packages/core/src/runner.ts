import {
  applyAction,
  buildMenu,
  createHand,
  positions,
  potSize,
  type HandConfig,
  type HandResult,
  type HandState,
  type MenuConfig,
  type Street,
} from '@ab/engine'
import { buildObservation, checkOrFold, NO_USAGE, type DecideResult, type Player } from '@ab/players'
import type { EventSink, FallbackKind } from './events'

export interface PlayHandOptions {
  config: HandConfig
  /** Every player seated in `config.seats`, by id. */
  players: ReadonlyMap<string, Player>
  sink: EventSink
  /** Per-decision limit; on expiry the player checks if free, otherwise folds. */
  decisionTimeoutMs: number
  /** Live pacing: minimum wall time per action (the difference is slept). 0 for the study. */
  paceMs?: number
  /** Consecutive fallbacks after which a player auto check/folds for the rest of the hand. */
  maxConsecutiveFallbacks?: number
  /** After a timeout, how long to wait for the aborted player to report what it spent. Default 250 ms. */
  timeoutGraceMs?: number
  menu?: Partial<MenuConfig>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const STREET_AT: Record<number, Street> = { 3: 'flop', 4: 'turn', 5: 'river' }

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

type Asked = { result: DecideResult; timedOut: boolean }

/** Guards against players returning something that isn't a DecideResult. */
function checked(r: unknown, model: string): DecideResult {
  const x = r as Partial<DecideResult> | null
  if (x && typeof x === 'object' && x.usage && typeof x.model === 'string') {
    if (x.ok === true && x.decision && typeof x.decision.optionId === 'string') return x as DecideResult
    if (x.ok === false && typeof x.error === 'string' && (x.kind === 'model' || x.kind === 'infra')) return x as DecideResult
  }
  return { ok: false, error: 'malformed player result', kind: 'infra', usage: NO_USAGE, model }
}

/**
 * Calls the player under a timeout. Never throws: rejections and timeouts become failures.
 * On timeout the player is aborted and given `graceMs` to resolve, so money it already spent
 * (e.g. a billed first attempt) is still recorded.
 */
async function ask(player: Player, obs: Parameters<Player['decide']>[0], timeoutMs: number, graceMs: number): Promise<Asked> {
  const ac = new AbortController()
  // Promise.resolve().then: a player that throws synchronously or returns a non-promise can't crash the hand.
  const pending = Promise.resolve()
    .then(() => player.decide(obs, ac.signal))
    .then((r) => checked(r, player.model))
    .catch((e: unknown): DecideResult => ({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      kind: 'infra',
      usage: NO_USAGE,
      model: player.model,
    }))
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })
  const first = await Promise.race([pending, timeout])
  clearTimeout(timer)
  if (first !== 'timeout') return { result: first, timedOut: false }
  ac.abort()
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  const late = await Promise.race([pending, new Promise<null>((r) => (graceTimer = setTimeout(() => r(null), graceMs)))])
  clearTimeout(graceTimer)
  return {
    result: { ok: false, error: 'timeout', kind: 'infra', usage: late?.usage ?? NO_USAGE, model: late?.model ?? player.model },
    timedOut: true,
  }
}

/** Emits a street_dealt event for each street whose cards appeared since `fromLength`. */
function emitStreets(sink: EventSink, state: HandState, fromLength: number): void {
  for (const length of [3, 4, 5]) {
    if (fromLength < length && state.board.length >= length) {
      const start = length === 3 ? 0 : length - 1
      sink.append({
        type: 'street_dealt',
        handId: state.config.handId ?? null,
        street: STREET_AT[length]!,
        cards: state.board.slice(start, length),
        board: state.board.slice(0, length),
      })
    }
  }
}

/** Plays one hand to completion, writing every event to `sink`. */
export async function playHand(opts: PlayHandOptions): Promise<HandResult> {
  const sleep = opts.sleep ?? defaultSleep
  const now = opts.now ?? (() => performance.now())
  const maxFallbacks = opts.maxConsecutiveFallbacks ?? 3
  const handId = opts.config.handId ?? null
  for (const s of opts.config.seats) {
    if (!opts.players.has(s.id)) throw new Error(`no player for seat ${s.id}`)
  }

  let state = createHand(opts.config)
  const names = positions(state.seats.length, state.config.buttonIndex)
  opts.sink.append({
    type: 'hand_started',
    handId,
    buttonIndex: state.config.buttonIndex,
    smallBlind: state.config.smallBlind,
    bigBlind: state.config.bigBlind,
    seats: state.seats.map((s, i) => ({ playerId: s.id, stack: s.startingStack, position: names[i]! })),
    posts: state.history
      .filter((h) => h.kind === 'post_sb' || h.kind === 'post_bb')
      .map((h) => ({ playerId: h.playerId, blind: h.kind === 'post_sb' ? ('sb' as const) : ('bb' as const), amount: h.amount })),
  })
  opts.sink.append({ type: 'cards_dealt', handId, holes: Object.fromEntries(state.seats.map((s) => [s.id, [...s.hole]])) })
  emitStreets(opts.sink, state, 0)

  const consecutiveFallbacks = new Map<string, number>()
  while (!state.complete) {
    const seatIndex = state.toAct!
    const seat = state.seats[seatIndex]!
    const player = opts.players.get(seat.id)!
    const menu = buildMenu(state, opts.menu)
    const obs = buildObservation(state, menu)
    opts.sink.append({ type: 'turn_started', handId, playerId: seat.id, options: obs.options })

    const started = now()
    const auto = (consecutiveFallbacks.get(seat.id) ?? 0) >= maxFallbacks
    const asked: Asked = auto
      ? { result: { ok: false, error: 'auto: too many failures', kind: 'infra', usage: NO_USAGE, model: player.model }, timedOut: false }
      : await ask(player, obs, opts.decisionTimeoutMs, opts.timeoutGraceMs ?? 250)
    const res = asked.result
    // A timeout counts as exactly the time limit, however quickly the player reacts to the abort,
    // so latency data doesn't depend on how a player handles cancellation.
    const latencyMs = auto ? 0 : asked.timedOut ? opts.decisionTimeoutMs : now() - started

    let chosen = res.ok ? menu.find((o) => o.id === res.decision.optionId) : undefined
    let fallbackReason: string | null = null
    let fallbackKind: FallbackKind | null = null
    if (!res.ok) {
      fallbackReason = res.error
      fallbackKind = auto ? 'auto' : asked.timedOut ? 'timeout' : res.kind
    } else if (!chosen) {
      fallbackReason = `invalid option: ${res.decision.optionId}`
      fallbackKind = 'model'
    }
    if (!chosen) chosen = menu.find((o) => o.id === checkOrFold(obs))!
    consecutiveFallbacks.set(seat.id, fallbackReason !== null ? (consecutiveFallbacks.get(seat.id) ?? 0) + 1 : 0)

    if (opts.paceMs && latencyMs < opts.paceMs) await sleep(opts.paceMs - latencyMs)

    const decision = res.ok && fallbackReason === null ? res.decision : null
    opts.sink.append({
      type: 'decision',
      handId,
      street: state.street,
      playerId: seat.id,
      position: names[seatIndex]!,
      model: res.model,
      optionId: chosen.id,
      label: chosen.label,
      action: chosen.action,
      chipsIn: chosen.cost,
      pot: potSize(state),
      currentBet: state.currentBet,
      toCall: obs.facts.toCall,
      winProbability: decision?.winProbability ?? null,
      confidence: decision?.confidence ?? null,
      optionProbabilities: decision?.optionProbabilities ?? null,
      reasoning: decision?.reasoning ?? null,
      latencyMs,
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      reasoningTokens: res.usage.reasoningTokens,
      costUsd: res.usage.costUsd,
      retries: res.usage.retries,
      fallback: fallbackReason !== null,
      fallbackKind,
      fallbackReason,
    })

    const boardBefore = state.board.length
    state = applyAction(state, chosen.action)
    emitStreets(opts.sink, state, boardBefore)
  }

  const result = state.result!
  if (result.showdown) {
    opts.sink.append({
      type: 'showdown',
      handId,
      hands: Object.fromEntries(
        Object.entries(result.hands).map(([id, v]) => [
          id,
          { hole: [...state.seats.find((s) => s.id === id)!.hole], category: v.category, label: v.label, value: v.value },
        ]),
      ),
    })
  }
  for (const award of result.awards) {
    opts.sink.append({ type: 'pot_awarded', handId, amount: award.amount, eligible: award.eligible, winners: award.winners, shares: award.shares })
  }
  opts.sink.append({ type: 'hand_ended', handId, stacks: result.stacks, net: result.net })
  return result
}
