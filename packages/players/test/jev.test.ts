import { createHand } from '@ab/engine'
import { describe, expect, it } from 'vitest'
import { ACTION_INSTRUCTIONS, chooseMove, JevPlayer, WIN_INSTRUCTIONS } from '../src/jev/jev-player'
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
    const jev = new JevPlayer({ id: 'hex', model: 'jev-1.13.0', client: { apiKey: 'test', fetch: fake.fn } })
    const res = await jev.decide(obs, signal)
    expect(res).toEqual({
      ok: true,
      decision: {
        optionId: 'call',
        winProbability: 0.57,
        confidence: 0.41,
        optionProbabilities: { fold: 0.1, call: 0.6, all_in: 0.3 },
        reasoning: null,
        jevChoice: 'call',
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

  const quiet = { apiKey: 'test', logLevel: 'off' as const }

  it('returns an infrastructure failure (not a throw) on API errors, without retrying', async () => {
    for (const status of [401, 429, 500]) {
      const fake = fakeFetch([{ status, body: { error: 'nope' } }, { status: 200, body: okBody }])
      const jev = new JevPlayer({ id: 'hex', model: 'jev-1.13.0', client: { ...quiet, fetch: fake.fn } })
      const res = await jev.decide(obs, signal)
      expect(res).toMatchObject({ ok: false, kind: 'infra' })
      expect(fake.requests).toHaveLength(1) // same as the LLM seats: no infrastructure retry
    }
  })

  it('treats an answer outside the offered options, or a missing win probability, as an API fault', async () => {
    const offOption = { ...okBody, answers: { ...okBody.answers, action: { ...okBody.answers.action, choice: 'raise' } } }
    const noWin = { ...okBody, answers: { action: okBody.answers.action } }
    for (const body of [offOption, noWin]) {
      const fake = fakeFetch([{ status: 200, body }])
      const jev = new JevPlayer({ id: 'hex', model: 'jev-1.13.0', client: { ...quiet, fetch: fake.fn } })
      expect(await jev.decide(obs, signal)).toMatchObject({ ok: false, kind: 'infra' })
    }
  })

  it('keeps only offered options in the probabilities and records the model that answered', async () => {
    const extra = { ...okBody, model: 'jev-1.13.1', answers: { ...okBody.answers, action: { ...okBody.answers.action, probabilities: { ...okBody.answers.action.probabilities, raise: 0.2 } } } }
    const fake = fakeFetch([{ status: 200, body: extra }])
    const res = await new JevPlayer({ id: 'hex', model: 'jev-1.13.0', client: { ...quiet, fetch: fake.fn } }).decide(obs, signal)
    expect(res.ok && res.decision.optionProbabilities).toEqual({ fold: 0.1, call: 0.6, all_in: 0.3 })
    expect(res.model).toBe('jev-1.13.1')
  })

  it('returns a failure (not a throw) on a malformed 200 response', async () => {
    const html = async () => new Response('<html>gateway</html>', { status: 200, headers: { 'content-type': 'text/html' } })
    const errorBody = async () => new Response(JSON.stringify({ error: 'overloaded' }), { status: 200, headers: { 'content-type': 'application/json' } })
    for (const fetchImpl of [html, errorBody]) {
      const res = await new JevPlayer({ id: 'hex', model: 'jev-1.13.0', client: { ...quiet, fetch: fetchImpl } }).decide(obs, signal)
      expect(res).toMatchObject({ ok: false, kind: 'infra' })
    }
  })

  it('stops when the runner aborts', async () => {
    const hang = async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    const ac = new AbortController()
    const pending = new JevPlayer({ id: 'hex', model: 'jev-1.13.0', client: { ...quiet, fetch: hang } }).decide(obs, ac.signal)
    ac.abort()
    expect(await pending).toMatchObject({ ok: false, kind: 'infra' })
  })

  it('chooses the kind of move by its total weight, then the size: raising is several options, calling is one', () => {
    // From the first real smoke run: 52% on raising spread over four sizes, 42% on calling. Taking the
    // single most likely option played the call every time, and Jev never raised after the flop.
    const split = { fold: 0.06, call: 0.42, min_raise: 0.14, open_3bb: 0.16, open_4bb: 0.12, all_in: 0.1 }
    expect(chooseMove(split, 'call')).toBe('open_3bb')
    // Checking against betting: the same, 55 against 45.
    expect(chooseMove({ check: 0.45, bet_half_pot: 0.2, bet_pot: 0.2, all_in: 0.15 }, 'check')).toBe('bet_half_pot')
    // When the passive move really has the most weight, it stays.
    expect(chooseMove({ fold: 0.1, call: 0.6, all_in: 0.3 }, 'call')).toBe('call')
    expect(chooseMove({ fold: 0.5, call: 0.3, min_raise: 0.2 }, 'fold')).toBe('fold')
    // A tie between kinds keeps Jev's own choice, so nothing turns on the order of the options.
    expect(chooseMove({ check: 0.5, bet_pot: 0.25, bet_half_pot: 0.25 }, 'check')).toBe('check')
    expect(chooseMove({ check: 0.5, bet_pot: 0.25, bet_half_pot: 0.25 }, 'bet_pot')).toBe('bet_pot')
  })

  it('plays the move chooseMove picks, and keeps every probability Jev gave', async () => {
    const raises = obs.options.map((o) => o.id).filter((id) => id !== 'fold' && id !== 'call' && id !== 'check')
    expect(raises.length).toBeGreaterThanOrEqual(2)
    const probabilities: Record<string, number> = { fold: 0.06, call: 0.42 }
    raises.forEach((id, i) => (probabilities[id] = i === 0 ? 0.2 : 0.32 / (raises.length - 1)))
    const body = { ...okBody, answers: { ...okBody.answers, action: { type: 'choice', choice: 'call', confidence: 0.3, probabilities } } }
    const fake = fakeFetch([{ status: 200, body }])
    const jev = new JevPlayer({ id: 'hex', model: 'jev-1.13.0', client: { apiKey: 'test', fetch: fake.fn } })
    const res = await jev.decide(obs, signal)
    expect(res.ok && res.decision.optionId).toBe(raises[0])
    expect(res.ok && res.decision.optionProbabilities).toEqual(probabilities)
    // TypeSafe's own pick is kept too, so the write-up can say how often the rule changed the move.
    expect(res.ok && res.decision.jevChoice).toBe('call')
  })
})
