import { applyAction, buildMenu, createHand, type HandState } from '@ab/engine'
import { describe, expect, it } from 'vitest'
import { CallingStation, preflopStrength, RandomBot, TagBot } from '../src/bots'
import { MockLlm } from '../src/mock'
import { buildObservation } from '../src/observation'
import type { Player } from '../src/types'

const signal = new AbortController().signal

async function playOut(players: Player[], seed: number): Promise<HandState> {
  let s = createHand({
    seats: players.map((p) => ({ id: p.id, stack: 10_000 })),
    buttonIndex: 0,
    smallBlind: 50,
    bigBlind: 100,
    seed,
  })
  while (!s.complete) {
    const menu = buildMenu(s)
    const player = players[s.toAct!]!
    const res = await player.decide(buildObservation(s, menu), signal)
    if (!res.ok) throw new Error(res.error)
    const option = menu.find((o) => o.id === res.decision.optionId)
    if (!option) throw new Error(`${player.id} chose ${res.decision.optionId}`)
    s = applyAction(s, option.action)
  }
  return s
}

describe('bots', () => {
  it('only ever choose offered options, over many hands', async () => {
    for (let seed = 0; seed < 300; seed++) {
      const s = await playOut([new RandomBot('r', seed), new CallingStation('c'), new TagBot('t'), new MockLlm('m')], seed)
      expect(s.complete).toBe(true)
    }
  })

  it('rank preflop hands sensibly', () => {
    expect(preflopStrength(['As', 'Ad'])).toBe(1)
    expect(preflopStrength(['As', 'Ks'])).toBeGreaterThan(preflopStrength(['7c', '2d']))
    expect(preflopStrength(['7c', '2d'])).toBeLessThan(0.3)
  })

  it('calling station never folds or raises', async () => {
    const station = new CallingStation('c')
    let s = createHand({ seats: [{ id: 'x', stack: 1000 }, { id: 'c', stack: 1000 }], buttonIndex: 0, smallBlind: 50, bigBlind: 100, seed: 1 })
    s = applyAction(s, { type: 'raise', to: 300 })
    const res = await station.decide(buildObservation(s), signal)
    expect(res.ok && res.decision.optionId).toBe('call')
  })
})

describe('MockLlm', () => {
  const obsFor = () =>
    buildObservation(createHand({ seats: [{ id: 'a', stack: 1000 }, { id: 'b', stack: 1000 }], buttonIndex: 0, smallBlind: 50, bigBlind: 100, seed: 2 }))

  it('reports fake usage and reasoning', async () => {
    const res = await new MockLlm('m', 'mock/llm', { inputPricePerMTok: 2 }).decide(obsFor(), signal)
    expect(res.ok).toBe(true)
    expect(res.usage.inputTokens).toBeGreaterThan(50)
    expect(res.usage.costUsd).toBeCloseTo((res.usage.inputTokens * 2) / 1e6)
    expect(res.ok && res.decision.reasoning).toMatch(/^mock:/)
  })

  it('injects failures and invalid options on schedule', async () => {
    const m = new MockLlm('m', 'mock/llm', { failEvery: 2, invalidEvery: 3 })
    const results = []
    for (let i = 0; i < 3; i++) results.push(await m.decide(obsFor(), signal))
    expect(results[0]!.ok).toBe(true)
    expect(results[1]!.ok).toBe(false)
    expect(results[2]!.ok && results[2]!.decision.optionId).toBe('not_an_option')
  })

  it('stops when aborted', async () => {
    const ac = new AbortController()
    const pending = new MockLlm('m', 'mock/llm', { latencyMs: 1000 }).decide(obsFor(), ac.signal)
    ac.abort()
    await expect(pending).rejects.toThrow(/aborted/)
  })
})
