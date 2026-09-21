import { createHand } from '@ab/engine'
import { describe, expect, it } from 'vitest'
import { ACTION_INSTRUCTIONS, JevPlayer, WIN_INSTRUCTIONS } from '../src/jev/jev-player'
import { buildObservation } from '../src/observation'

const obs = buildObservation(
  createHand({ seats: [{ id: 'a', stack: 1000 }, { id: 'b', stack: 1000 }], buttonIndex: 0, smallBlind: 50, bigBlind: 100, seed: 2 }),
)
const signal = new AbortController().signal

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = []
  const fn = async (url: string, init?: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init!.body)) })
    const r = responses.shift()!
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } })
  }
  return { fn, requests }
}

const okBody = {
  model: 'jev-1.13.0',
  answers: {
    action: { type: 'choice', choice: 'call', confidence: 0.41, probabilities: { fold: 0.1, call: 0.6, all_in: 0.3 } },
    win: { type: 'noul', noul: 0.57 },
  },
  usage: { input_tokens: 500, output_tokens: 3 },
}

describe('JevPlayer', () => {
  it('asks one Choice over the offered options plus a win Noul, and maps the answer', async () => {
    const fake = fakeFetch([{ status: 200, body: okBody }])
    const jev = new JevPlayer({ id: 'jev', model: 'jev-1.13.0', client: { apiKey: 'test', fetch: fake.fn } })
    const res = await jev.decide(obs, signal)
    expect(res).toEqual({
      ok: true,
      decision: {
        optionId: 'call',
        winProbability: 0.57,
        confidence: 0.41,
        optionProbabilities: { fold: 0.1, call: 0.6, all_in: 0.3 },
        reasoning: null,
      },
      usage: { inputTokens: 500, outputTokens: 3, reasoningTokens: 0, costUsd: (500 * 0.042) / 1e6, retries: 0 },
      model: 'jev-1.13.0',
    })
    const req = fake.requests[0]!
    expect(req.url).toMatch(/\/v1\/systemone$/)
    expect(req.body.model).toBe('jev-1.13.0')
    const questions = req.body.questions as Record<string, { type: string; instructions: string; criteria?: unknown }>
    expect(questions.action).toEqual({
      type: 'choice',
      instructions: ACTION_INSTRUCTIONS,
      criteria: Object.fromEntries(obs.options.map((o) => [o.id, o.label])),
    })
    expect(questions.win).toMatchObject({ type: 'noul', instructions: WIN_INSTRUCTIONS })
    // Same facts as the LLMs get, minus the options (which are the Choice criteria).
    expect(req.body.state).toEqual(JSON.parse(JSON.stringify({ ...obs, options: undefined })))
  })

  it('returns a failure (not a throw) on API errors', async () => {
    const fake = fakeFetch([{ status: 401, body: { error: 'bad key' } }])
    const jev = new JevPlayer({ id: 'jev', model: 'jev-1.13.0', client: { apiKey: 'test', fetch: fake.fn }, maxRetries: 0 })
    const res = await jev.decide(obs, signal)
    expect(res).toMatchObject({ ok: false, kind: 'infra' })
  })
})
