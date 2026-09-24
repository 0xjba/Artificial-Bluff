import { choice, noul, TypeSafeClient, type Questions, type TypeSafeClientConfig } from '@typesafe-ai/sdk'
import type { OptionId } from '@ab/engine'
import { OPTION_SEMANTICS, WIN_CONDITION } from '../llm/prompt'
import { NO_USAGE, type DecideResult, type Observation, type Player } from '../types'

/**
 * Question wording. Jev answers the question as literally written, so keep these exact and
 * change them only with a new pre-registration. The win definition and option semantics are the
 * same text the LLMs get, so both kinds of player answer the same questions.
 *
 * Modes (JevMode): the main study asked one Choice and played it through chooseMove; 'raw' plays
 * TypeSafe's choice as returned; 'two-step' asks what kind of move and, separately, what amount, and
 * plays exactly what Jev picked. No mode adds strategy of ours: code never decides when to fold or raise.
 */
export const ACTION_INSTRUCTIONS =
  `You are the player marked "you": true in this No-Limit Texas Hold'em hand ("stack" is chips behind, ` +
  `"bet" is chips bet this street, "facts" are precomputed). ${OPTION_SEMANTICS} ` +
  'Which action maximises your expected chips?'
export const WIN_INSTRUCTIONS = `The player marked "you": true will ${WIN_CONDITION}.`

const SPOT = `You are the player marked "you": true in this No-Limit Texas Hold'em hand ("stack" is chips behind, "bet" is chips bet this street, "facts" are precomputed).`
/** Two-step mode: the kind of action (fold; check or call; bet or raise), asked beside the amount. */
export const KIND_INSTRUCTIONS = `${SPOT} Which kind of action maximises your expected chips?`
/** Two-step mode: the amount, among the bet and raise sizes offered. */
export const SIZE_INSTRUCTIONS = `${SPOT} ${OPTION_SEMANTICS} If you bet or raise, which amount maximises your expected chips?`
/** The kind question's id for betting or raising (its amount comes from the size question). */
export const BET_OR_RAISE = 'bet_or_raise'

/**
 * How each Jev seat's answer becomes the move played. 'rule' is the main study's (see chooseMove);
 * the rules are pre-registered as written here.
 */
export type JevMode = 'rule' | 'raw' | 'two-step'
export const JEV_MODE_RULES: Record<Exclude<JevMode, 'rule'>, string> = {
  raw: "one Choice over the offered options; TypeSafe's choice is played as returned, and code changes nothing",
  'two-step':
    'two Choices asked together: the kind of action among those offered (fold; check or call; bet or raise) and the amount among the bet and raise sizes offered; ' +
    'the move is the kind Jev chose, at the amount it chose when betting or raising, and code changes nothing',
}

/**
 * USD per 1M input tokens; output tokens are free. Source: TypeSafe, "Introducing System One Models &
 * Jev" (https://typesafe.ai/blog/introducing-system-one-models-and-jev), read 2026-09-21:
 * "$0.042 / MTok" input, output "FREE (too cheap to meter)". Recorded in every game's config.
 */
export const JEV_INPUT_PRICE_PER_MTOK = 0.042

/** The kind of move an option is: sizes of the same bet or raise are one kind. */
const kindOf = (id: string): 'fold' | 'passive' | 'aggressive' => (id === 'fold' ? 'fold' : id === 'check' || id === 'call' ? 'passive' : 'aggressive')

/**
 * The move Jev's answer stands for. The Choice spreads its weight over every option offered, and raising
 * comes in several sizes while calling is one option, so the single most likely option under-counts
 * raising: 52% on raising over four sizes loses to 42% on calling. First the kind of move with the most
 * total weight (fold, check or call, bet or raise), then the most likely option of that kind. Ties keep
 * TypeSafe's own choice. Stated in the pre-registration.
 */
export function chooseMove(probabilities: Partial<Record<string, number>>, jevChoice: string): string {
  const entries = Object.entries(probabilities).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]))
  if (entries.length === 0) return jevChoice
  const weight = new Map<string, number>()
  for (const [id, p] of entries) weight.set(kindOf(id), (weight.get(kindOf(id)) ?? 0) + p)
  const own = kindOf(jevChoice)
  let kind = own
  for (const [k, w] of weight) if (w > (weight.get(kind) ?? 0)) kind = k as typeof kind
  let best = kind === own ? jevChoice : null
  let bestP = best === null ? -Infinity : (probabilities[best] ?? 0)
  for (const [id, p] of entries) if (kindOf(id) === kind && p > bestP) [best, bestP] = [id, p]
  return best ?? jevChoice
}

export interface JevPlayerOptions {
  id: string
  /** Pinned model version, e.g. "jev-1.13.0". The model that answered is recorded per decision. */
  model: string
  /** How the answer becomes a move; left out, the main study's 'rule'. */
  mode?: Exclude<JevMode, 'rule'>
  /** Passed to TypeSafeClient (apiKey, fetch for tests, etc.). */
  client?: TypeSafeClientConfig
  /** USD per 1M input tokens (default JEV_INPUT_PRICE_PER_MTOK); output is free. */
  inputPricePerMTok?: number
  /**
   * SDK per-attempt timeout (ms). Kept above the table's decision timeout so the same runner timeout
   * governs Jev and the LLMs. Default 60 s.
   */
  timeoutMs?: number
}

type Answer = { choice?: string; confidence?: number; probabilities?: Record<string, number>; noul?: number } | undefined

/** Two-step mode's questions for this spot: kinds offered, and the bet and raise sizes offered. */
function twoStep(obs: Observation) {
  const sizes = obs.options.filter((o) => kindOf(o.id) === 'aggressive')
  const kinds: Record<string, string> = {}
  for (const o of obs.options) if (kindOf(o.id) !== 'aggressive') kinds[o.id] = o.label
  if (sizes.length) kinds[BET_OR_RAISE] = 'Bet or raise (the amount is chosen separately)'
  return { kinds, sizes }
}

/**
 * The Jev seat: one systemOne call per decision, its question(s) about the move plus a win Noul.
 * No SDK retries: the LLM seats get no infrastructure retry either, so failures are treated alike.
 */
export class JevPlayer implements Player {
  readonly kind = 'jev' as const
  readonly id: string
  readonly model: string
  readonly mode: JevMode
  // ES-private so the API key can't leak through JSON.stringify or console.log of a player.
  readonly #options: JevPlayerOptions
  readonly #client: TypeSafeClient

  constructor(options: JevPlayerOptions) {
    this.#options = options
    this.id = options.id
    this.model = options.model
    this.mode = options.mode ?? 'rule'
    this.#client = new TypeSafeClient({ defaultModel: options.model, ...options.client })
  }

  async decide(obs: Observation, signal: AbortSignal): Promise<DecideResult> {
    const { options, ...state } = obs
    const offered = new Set<string>(options.map((o) => o.id))
    const steps = this.mode === 'two-step' ? twoStep(obs) : null
    const questions: Questions = { win: noul(WIN_INSTRUCTIONS) }
    if (steps) {
      // A question with one possible answer isn't asked: that answer is the only move there is.
      if (Object.keys(steps.kinds).length > 1) questions.kind = choice(KIND_INSTRUCTIONS, steps.kinds)
      if (steps.sizes.length > 1) questions.size = choice(SIZE_INSTRUCTIONS, Object.fromEntries(steps.sizes.map((o) => [o.id, o.label])))
    } else questions.action = choice(ACTION_INSTRUCTIONS, Object.fromEntries(options.map((o) => [o.id, o.label])))
    let res
    try {
      res = await this.#client.systemOne(
        { model: this.model, state: JSON.parse(JSON.stringify(state)), questions },
        { signal, timeout: this.#options.timeoutMs ?? 60_000, retry: { maxRetries: 0 } },
      )
    } catch (e) {
      return { ok: false, error: (e as Error).message, kind: 'infra', usage: NO_USAGE, model: this.model }
    }
    if (!res || typeof res !== 'object' || !res.usage || !res.answers) {
      return { ok: false, error: 'malformed API response', kind: 'infra', usage: NO_USAGE, model: this.model }
    }
    const usage = {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      reasoningTokens: 0,
      costUsd: (res.usage.input_tokens * (this.#options.inputPricePerMTok ?? JEV_INPUT_PRICE_PER_MTOK)) / 1_000_000,
      retries: 0,
    }
    const answers = res.answers as Record<string, Answer>
    const win = answers.win?.noul
    if (typeof win !== 'number' || !Number.isFinite(win) || win < 0 || win > 1) {
      return { ok: false, error: 'api returned no valid win probability', kind: 'infra', usage, model: res.model }
    }
    // TypeSafe guarantees answers come from the criteria given; if the API ever breaks that, it is an
    // infrastructure fault, not Jev's decision.
    const notOffered = (what: unknown) => ({ ok: false as const, error: `api returned an option that was not offered: ${String(what)}`, kind: 'infra' as const, usage, model: res.model })
    const probs = (a: Answer) => Object.fromEntries(Object.entries(a?.probabilities ?? {}).filter(([, p]) => typeof p === 'number' && Number.isFinite(p)))

    if (steps) {
      const kindIds = Object.keys(steps.kinds)
      const kind = questions.kind ? answers.kind?.choice : kindIds[0]
      if (typeof kind !== 'string' || !kindIds.includes(kind)) return notOffered(answers.kind?.choice)
      const size = questions.size ? answers.size?.choice : steps.sizes[0]?.id
      if (kind === BET_OR_RAISE && (typeof size !== 'string' || !offered.has(size))) return notOffered(answers.size?.choice)
      // One distribution over the options, for the log: each kind's weight, a raise's split by amount.
      const kp = questions.kind ? probs(answers.kind) : { [kindIds[0]!]: 1 }
      const sp = questions.size ? probs(answers.size) : steps.sizes[0] ? { [steps.sizes[0].id]: 1 } : {}
      const optionProbabilities: Partial<Record<OptionId, number>> = {}
      for (const id of kindIds) if (id !== BET_OR_RAISE) optionProbabilities[id as OptionId] = kp[id] ?? 0
      for (const o of steps.sizes) optionProbabilities[o.id] = (kp[BET_OR_RAISE] ?? 0) * (sp[o.id] ?? 0)
      return {
        ok: true,
        decision: {
          optionId: (kind === BET_OR_RAISE ? size : kind) as OptionId,
          winProbability: win,
          confidence: questions.kind ? (answers.kind?.confidence ?? null) : null,
          optionProbabilities,
          reasoning: null,
        },
        usage,
        model: res.model,
      }
    }

    const action = answers.action
    if (typeof action?.choice !== 'string' || !offered.has(action.choice)) return notOffered(action?.choice)
    const optionProbabilities = Object.fromEntries(Object.entries(probs(action)).filter(([id]) => offered.has(id))) as Partial<Record<OptionId, number>>
    const raw = this.mode === 'raw'
    return {
      ok: true,
      decision: {
        optionId: (raw ? action.choice : chooseMove(optionProbabilities, action.choice)) as OptionId,
        winProbability: win,
        // Jev's confidence is derived from how concentrated its option probabilities are (TypeSafe's
        // definition); the LLMs' is self-reported. Analyse them separately.
        confidence: action.confidence ?? null,
        optionProbabilities,
        reasoning: null,
        // TypeSafe's own pick, where the main study's rule may have changed it.
        ...(raw ? {} : { jevChoice: action.choice as OptionId }),
      },
      usage,
      model: res.model,
    }
  }
}
