import { evaluateHand, mulberry32, rankValue, type OptionId } from '@ab/engine'
import { NO_USAGE, type DecideResult, type Decision, type Observation, type Player } from './types'

function decision(optionId: OptionId, extra: Partial<Decision> = {}): Decision {
  return { optionId, winProbability: null, confidence: null, optionProbabilities: null, reasoning: null, ...extra }
}

function has(obs: Observation, id: OptionId): boolean {
  return obs.options.some((o) => o.id === id)
}

/** Check if free, otherwise call if possible, otherwise fold. */
export function passiveChoice(obs: Observation): OptionId {
  if (has(obs, 'check')) return 'check'
  if (has(obs, 'call')) return 'call'
  return 'fold'
}

/** Check if free, otherwise fold. The runner's timeout/failure default. */
export function checkOrFold(obs: Observation): OptionId {
  return has(obs, 'check') ? 'check' : 'fold'
}

/** 0-1 preflop strength from a simple score: pairs, high cards, suitedness, connectedness. */
export function preflopStrength(hole: Observation['hole']): number {
  const [a, b] = hole.map(rankValue).sort((x, y) => y - x) as [number, number]
  const suited = hole[0]![1] === hole[1]![1]
  let score = a * 1.2 + b * 0.8
  if (a === b) score += 12 + a
  if (suited) score += 3
  const gap = a - b
  if (gap === 1) score += 2
  else if (gap === 2) score += 1
  else if (gap >= 4) score -= gap - 3
  return Math.max(0, Math.min(1, score / 44))
}

const RAISES: OptionId[] = ['open_3bb', 'reraise_2_5x', 'pot_75', 'pot_50', 'min_raise']

/** Rule-based tight-aggressive choice used by TagBot and MockLlm. */
export function tagChoice(obs: Observation): { optionId: OptionId; winProbability: number } {
  const bb = obs.facts.bigBlind
  const raise = RAISES.find((id) => has(obs, id))
  if (obs.street === 'preflop') {
    const strength = preflopStrength(obs.hole)
    if (strength >= 0.75 && raise) return { optionId: raise, winProbability: strength * 0.8 }
    if (strength >= 0.5 && obs.facts.toCall <= 3 * bb) return { optionId: passiveChoice(obs), winProbability: strength * 0.6 }
    return { optionId: checkOrFold(obs), winProbability: strength * 0.4 }
  }
  const value = evaluateHand([...obs.hole, ...obs.board])
  const strong = ['straight_flush', 'four_of_a_kind', 'full_house', 'flush', 'straight', 'three_of_a_kind', 'two_pair']
  if (strong.includes(value.category) && raise) return { optionId: raise, winProbability: 0.8 }
  if (value.category === 'one_pair' && obs.facts.potOddsPct <= 30) return { optionId: passiveChoice(obs), winProbability: 0.5 }
  return { optionId: checkOrFold(obs), winProbability: 0.2 }
}

abstract class BotBase implements Player {
  readonly kind = 'bot' as const
  constructor(
    readonly id: string,
    readonly model: string,
  ) {}
  protected abstract choose(obs: Observation): Decision
  async decide(obs: Observation, _signal?: AbortSignal): Promise<DecideResult> {
    return { ok: true, decision: this.choose(obs), usage: NO_USAGE, model: this.model }
  }
}

/** Picks uniformly among the offered options (seeded). */
export class RandomBot extends BotBase {
  private readonly rand: () => number
  constructor(id: string, seed: number) {
    super(id, 'bot/random')
    this.rand = mulberry32(seed)
  }
  protected choose(obs: Observation): Decision {
    return decision(obs.options[Math.floor(this.rand() * obs.options.length)]!.id)
  }
}

/** Never folds or raises: checks or calls. */
export class CallingStation extends BotBase {
  constructor(id: string) {
    super(id, 'bot/calling-station')
  }
  protected choose(obs: Observation): Decision {
    return decision(passiveChoice(obs))
  }
}

/** Simple tight-aggressive rules. Also states a rough win probability. */
export class TagBot extends BotBase {
  constructor(id: string) {
    super(id, 'bot/tag')
  }
  protected choose(obs: Observation): Decision {
    const { optionId, winProbability } = tagChoice(obs)
    return decision(optionId, { winProbability })
  }
}
