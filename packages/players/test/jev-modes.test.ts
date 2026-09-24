import { createHand } from '@ab/engine'
import { describe, expect, it } from 'vitest'
import { BET_OR_RAISE, JevPlayer, KIND_INSTRUCTIONS, SIZE_INSTRUCTIONS, WIN_INSTRUCTIONS } from '../src/jev/jev-player'
import { buildObservation } from '../src/observation'
import type { Observation } from '../src/types'

const signal = new AbortController().signal
// Heads-up, preflop, the button (small blind) to act: fold, call 50, and several raise sizes.
const obs = buildObservation(createHand({ seats: [{ id: 'a', stack: 1000 }, { id: 'b', stack: 1000 }], buttonIndex: 0, smallBlind: 50, bigBlind: 100, seed: 2 }))
const sizes = obs.options.filter((o) => !['fold', 'check', 'call'].includes(o.id)).map((o) => o.id)

function fakeFetch(answers: Record<string, unknown>) {
  const requests: Array<{ questions: Record<string, { type: string; instructions: string; criteria?: Record<string, string> }> }> = []
  const fn = async (_url: string, init?: RequestInit) => {
    requests.push(JSON.parse(String(init!.body)))
    return new Response(JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 600, output_tokens: 3 } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { fn, requests }
}
const jev = (mode: 'raw' | 'two-step', fn: ReturnType<typeof fakeFetch>['fn']) => new JevPlayer({ id: 'hex', model: 'jev-1.13.0', mode, client: { apiKey: 'test', fetch: fn } })
const win = { type: 'noul', noul: 0.55 }

describe('Jev, two-step', () => {
  it('asks what kind of action and, separately, what amount, and plays exactly what Jev picked', async () => {
    expect(sizes.length).toBeGreaterThan(1)
    const fake = fakeFetch({
      win,
      kind: { type: 'choice', choice: BET_OR_RAISE, confidence: 0.4, probabilities: { fold: 0.1, call: 0.4, [BET_OR_RAISE]: 0.5 } },
      size: { type: 'choice', choice: sizes[1], confidence: 0.6, probabilities: Object.fromEntries(sizes.map((id, i) => [id, i === 1 ? 0.7 : 0.3 / (sizes.length - 1)])) },
    })
    const res = await jev('two-step', fake.fn).decide(obs, signal)
    const q = fake.requests[0]!.questions
    expect(Object.keys(q).sort()).toEqual(['kind', 'size', 'win'])
    expect(q.win).toMatchObject({ type: 'noul', instructions: WIN_INSTRUCTIONS })
    expect(q.kind).toMatchObject({ type: 'choice', instructions: KIND_INSTRUCTIONS })
    expect(Object.keys(q.kind!.criteria!)).toEqual(['fold', 'call', BET_OR_RAISE])
    expect(q.kind!.criteria!.call).toBe('Call 50')
    expect(q.size).toMatchObject({ type: 'choice', instructions: SIZE_INSTRUCTIONS })
    expect(Object.keys(q.size!.criteria!)).toEqual(sizes)
    expect(res).toMatchObject({ ok: true, decision: { optionId: sizes[1], winProbability: 0.55, confidence: 0.4, reasoning: null } })
    // Nothing of ours in between: no rule, so no "own pick" to compare against.
    expect(res.ok && res.decision).not.toHaveProperty('jevChoice')
    // The log keeps one distribution over the options: a raise's weight split by Jev's amounts.
    const p = res.ok ? res.decision.optionProbabilities! : {}
    expect(p.call).toBeCloseTo(0.4, 9)
    expect(p[sizes[1]!]).toBeCloseTo(0.35, 9)
    expect(Object.values(p).reduce((a, b) => a + b!, 0)).toBeCloseTo(1, 9)
  })

  it('plays a call when Jev picks one, whatever the amount question said', async () => {
    const fake = fakeFetch({
      win,
      kind: { type: 'choice', choice: 'call', confidence: 0.5, probabilities: { fold: 0.1, call: 0.6, [BET_OR_RAISE]: 0.3 } },
      size: { type: 'choice', choice: sizes[0], confidence: 0.9, probabilities: { [sizes[0]!]: 1 } },
    })
    expect(await jev('two-step', fake.fn).decide(obs, signal)).toMatchObject({ ok: true, decision: { optionId: 'call' } })
  })

  it('does not ask a question that has only one answer', async () => {
    const shove: Observation = { ...obs, options: obs.options.filter((o) => ['fold', 'call', 'all_in'].includes(o.id)) }
    const fake = fakeFetch({ win, kind: { type: 'choice', choice: BET_OR_RAISE, confidence: 0.5, probabilities: { fold: 0.2, call: 0.3, [BET_OR_RAISE]: 0.5 } } })
    const res = await jev('two-step', fake.fn).decide(shove, signal)
    expect(Object.keys(fake.requests[0]!.questions).sort()).toEqual(['kind', 'win'])
    expect(res).toMatchObject({ ok: true, decision: { optionId: 'all_in' } })
  })

  it('treats an answer outside what was offered as the API\'s fault, not a move', async () => {
    const fake = fakeFetch({ win, kind: { type: 'choice', choice: 'limp', confidence: 1, probabilities: {} } })
    expect(await jev('two-step', fake.fn).decide(obs, signal)).toMatchObject({ ok: false, kind: 'infra' })
  })
})

describe('Jev, raw', () => {
  it('plays TypeSafe\'s choice as returned, even where raising has more weight spread over its sizes', async () => {
    const probabilities: Record<string, number> = { fold: 0.06, call: 0.42 }
    sizes.forEach((id) => (probabilities[id] = 0.52 / sizes.length))
    const fake = fakeFetch({ win, action: { type: 'choice', choice: 'call', confidence: 0.3, probabilities } })
    const res = await jev('raw', fake.fn).decide(obs, signal)
    expect(Object.keys(fake.requests[0]!.questions).sort()).toEqual(['action', 'win'])
    expect(res).toMatchObject({ ok: true, decision: { optionId: 'call', optionProbabilities: probabilities } })
    expect(res.ok && res.decision).not.toHaveProperty('jevChoice')
  })
})
