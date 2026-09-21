import { CallingStation, RandomBot, TagBot } from './bots'
import { JevPlayer } from './jev/jev-player'
import { LlmPlayer, type ReasoningMode } from './llm/llm-player'
import type { Fetch } from './llm/openrouter'
import { MockLlm } from './mock'
import type { Player } from './types'

/** One seat in a line-up config. `id` is the character name (e.g. "jev", "pill"). */
export type PlayerSpec =
  | { id: string; kind: 'jev'; model: string }
  | { id: string; kind: 'llm'; model: string; reasoning?: ReasoningMode; structuredOutput?: boolean; sendTemperature?: boolean }
  | { id: string; kind: 'bot'; bot: 'random' | 'calling-station' | 'tag'; seed?: number }
  | { id: string; kind: 'mock'; model?: string; inputPricePerMTok?: number }

export interface PlayerEnv {
  OPENROUTER_API_KEY?: string
  TYPESAFE_API_KEY?: string
}

/** Builds a player from its spec. Keys come from `env`; `fetch` is injectable for tests. */
export function createPlayer(spec: PlayerSpec, env: PlayerEnv, fetchImpl?: Fetch): Player {
  switch (spec.kind) {
    case 'jev': {
      if (!env.TYPESAFE_API_KEY) throw new Error(`${spec.id}: TYPESAFE_API_KEY is not set`)
      return new JevPlayer({ id: spec.id, model: spec.model, client: { apiKey: env.TYPESAFE_API_KEY, ...(fetchImpl ? { fetch: fetchImpl } : {}) } })
    }
    case 'llm': {
      if (!env.OPENROUTER_API_KEY) throw new Error(`${spec.id}: OPENROUTER_API_KEY is not set`)
      return new LlmPlayer({
        id: spec.id,
        model: spec.model,
        openrouter: { apiKey: env.OPENROUTER_API_KEY, ...(fetchImpl ? { fetch: fetchImpl } : {}) },
        ...(spec.reasoning !== undefined ? { reasoning: spec.reasoning } : {}),
        ...(spec.structuredOutput !== undefined ? { structuredOutput: spec.structuredOutput } : {}),
        ...(spec.sendTemperature !== undefined ? { sendTemperature: spec.sendTemperature } : {}),
      })
    }
    case 'bot':
      if (spec.bot === 'random') return new RandomBot(spec.id, spec.seed ?? 1)
      if (spec.bot === 'calling-station') return new CallingStation(spec.id)
      return new TagBot(spec.id)
    case 'mock':
      return new MockLlm(spec.id, spec.model ?? 'mock/llm', { inputPricePerMTok: spec.inputPricePerMTok ?? 1 })
  }
}

export function createPlayers(specs: PlayerSpec[], env: PlayerEnv, fetchImpl?: Fetch): Player[] {
  const ids = specs.map((s) => s.id)
  if (new Set(ids).size !== ids.length) throw new Error('player ids must be unique')
  return specs.map((s) => createPlayer(s, env, fetchImpl))
}
