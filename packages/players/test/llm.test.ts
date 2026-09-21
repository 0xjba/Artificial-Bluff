import { createHand } from '@ab/engine'
import { describe, expect, it } from 'vitest'
import { LlmPlayer, type LlmPlayerOptions } from '../src/llm/llm-player'
import { OpenRouterError, chatCompletion } from '../src/llm/openrouter'
import { parseDecision } from '../src/llm/parse'
import { SYSTEM_PROMPT, WIN_CONDITION, responseFormat } from '../src/llm/prompt'
import { buildObservation } from '../src/observation'

const obs = buildObservation(
  createHand({ seats: [{ id: 'a', stack: 1000 }, { id: 'b', stack: 1000 }], buttonIndex: 0, smallBlind: 50, bigBlind: 100, seed: 2 }),
)
const signal = new AbortController().signal

interface Reply {
  status?: number
  content?: string | null
  cost?: number
  finish?: string
  refusal?: string
  reasoningTokens?: number
  body?: string
}

/** A fake fetch that returns queued chat replies and records requests. */
function fakeFetch(replies: Reply[]) {
  const requests: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = []
  const fn = async (url: string, init?: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init!.body)), headers: init!.headers as Record<string, string> })
    const r = replies.shift()!
    const body =
      r.body ??
      JSON.stringify({
        model: 'vendor/model-2026',
        choices: [{ finish_reason: r.finish ?? 'stop', message: { content: r.content ?? null, refusal: r.refusal ?? null } }],
        usage: {
          prompt_tokens: 400,
          completion_tokens: 50,
          cost: r.cost ?? 0.001,
          completion_tokens_details: { reasoning_tokens: r.reasoningTokens ?? 0 },
        },
      })
    return new Response(body, { status: r.status ?? 200 })
  }
  return { fn, requests }
}

const valid = JSON.stringify({ action: 'call', win_probability: 0.55, confidence: 0.7, reasoning: 'Decent hand, cheap price.' })

describe('parseDecision', () => {
  it('accepts a valid reply, including one in a code fence or with text around it', () => {
    const expected = {
      ok: true,
      decision: { optionId: 'call', winProbability: 0.55, confidence: 0.7, optionProbabilities: null, reasoning: 'Decent hand, cheap price.' },
    }
    expect(parseDecision('```json\n' + valid + '\n```', obs)).toEqual(expected)
    expect(parseDecision('<think>hmm</think> Here you go: ' + valid + ' Good luck!', obs)).toEqual(expected)
  })

  it('normalises the action’s case and whitespace', () => {
    const r = parseDecision(JSON.stringify({ action: ' Call ', win_probability: 0.5, confidence: 0.5 }), obs)
    expect(r.ok && r.decision.optionId).toBe('call')
  })

  it('rejects unknown options, non-JSON and out-of-range probabilities with a specific error', () => {
    expect(parseDecision('nope', obs)).toEqual({ ok: false, error: 'reply did not contain a JSON object' })
    expect(parseDecision('{"action": }', obs)).toEqual({ ok: false, error: 'reply was not valid JSON' })
    expect(parseDecision('{"action":"raise","win_probability":0.5,"confidence":0.5}', obs)).toMatchObject({ ok: false, error: expect.stringMatching(/must be one of: fold, call/) })
  })

  it('rejects percentages instead of guessing a scale (calibration data must not be rescaled)', () => {
    for (const bad of [55, 1.5, -0.1, Number.NaN]) {
      const r = parseDecision(JSON.stringify({ action: 'call', win_probability: bad, confidence: 0.5 }), obs)
      expect(r).toMatchObject({ ok: false, error: '"win_probability" must be a number from 0 to 1' })
    }
    expect(parseDecision(JSON.stringify({ action: 'call', win_probability: 1, confidence: 0 }), obs).ok).toBe(true)
  })

  it('truncates long reasoning', () => {
    const r = parseDecision(JSON.stringify({ action: 'fold', win_probability: 0.3, confidence: 0.2, reasoning: 'x'.repeat(300) }), obs)
    expect(r.ok && r.decision.reasoning).toHaveLength(120)
  })
})

describe('prompt', () => {
  it('restricts the schema to this turn’s options and defines win and option semantics', () => {
    const schema = responseFormat(obs) as { json_schema: { schema: { properties: { action: { enum: string[] } } } } }
    expect(schema.json_schema.schema.properties.action.enum).toEqual(obs.options.map((o) => o.id))
    expect(SYSTEM_PROMPT).toContain('"Bet X", "Raise to X" and "All-in X" mean your total bet this street becomes X')
    expect(SYSTEM_PROMPT).toContain(`the probability that you ${WIN_CONDITION}`)
  })
})

describe('chatCompletion', () => {
  it('throws OpenRouterError on non-2xx', async () => {
    const { fn } = fakeFetch([{ status: 402, body: '{"error":"insufficient credits"}' }])
    await expect(chatCompletion({ apiKey: 'k', fetch: fn }, { model: 'm', messages: [] })).rejects.toBeInstanceOf(OpenRouterError)
  })

  it('reads finish reason, refusal and reasoning tokens', async () => {
    const { fn } = fakeFetch([{ content: 'x', finish: 'length', reasoningTokens: 120, refusal: 'no' }])
    const r = await chatCompletion({ apiKey: 'k', fetch: fn }, { model: 'm', messages: [] })
    expect(r).toMatchObject({ finishReason: 'length', refused: true, reasoningTokens: 120, completionTokens: 50 })
  })
})

describe('LlmPlayer', () => {
  const make = (fn: ReturnType<typeof fakeFetch>['fn'], extra: Partial<LlmPlayerOptions> = {}) =>
    new LlmPlayer({ id: 'pill', model: 'vendor/model', openrouter: { apiKey: 'test-key', fetch: fn }, ...extra })

  it('sends the prompt with structured output, low temperature and reasoning off, and reports cost', async () => {
    const fake = fakeFetch([{ content: valid, cost: 0.0021 }])
    const res = await make(fake.fn).decide(obs, signal)
    expect(res).toMatchObject({ ok: true, model: 'vendor/model-2026', usage: { inputTokens: 400, outputTokens: 50, reasoningTokens: 0, costUsd: 0.0021, retries: 0 } })
    const req = fake.requests[0]!
    expect(req.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(req.headers.Authorization).toBe('Bearer test-key')
    expect(req.body).toMatchObject({ model: 'vendor/model', temperature: 0.3, max_tokens: 150, reasoning: { effort: 'none' }, provider: { require_parameters: true } })
    expect((req.body.messages as Array<{ role: string }>).map((m) => m.role)).toEqual(['system', 'user'])
  })

  it('sends reasoning and temperature only as configured', async () => {
    const low = fakeFetch([{ content: valid }])
    await make(low.fn, { reasoning: 'low', sendTemperature: false }).decide(obs, signal)
    expect(low.requests[0]!.body).toMatchObject({ reasoning: { effort: 'low', exclude: true }, max_tokens: 1500 })
    expect(low.requests[0]!.body).not.toHaveProperty('temperature')
    const omit = fakeFetch([{ content: valid }])
    await make(omit.fn, { reasoning: 'omit', structuredOutput: false }).decide(obs, signal)
    expect(omit.requests[0]!.body).not.toHaveProperty('reasoning')
    expect(omit.requests[0]!.body).not.toHaveProperty('response_format')
    expect(omit.requests[0]!.body).not.toHaveProperty('provider')
  })

  it('retries once with the specific error, summing usage', async () => {
    const fake = fakeFetch([{ content: '{"action":"shove"}', cost: 0.001 }, { content: valid, cost: 0.001 }])
    const res = await make(fake.fn).decide(obs, signal)
    expect(res).toMatchObject({ ok: true, usage: { inputTokens: 800, costUsd: 0.002, retries: 1 } })
    const retryMessages = fake.requests[1]!.body.messages as Array<{ role: string; content: string }>
    expect(retryMessages.at(-1)!.content).toMatch(/invalid: "action" must be one of/)
  })

  it('gives up after a second invalid reply as a model failure, still reporting what it cost', async () => {
    const fake = fakeFetch([{ content: 'hmm' }, { content: 'still no' }])
    const res = await make(fake.fn).decide(obs, signal)
    expect(res).toMatchObject({ ok: false, kind: 'model', error: expect.stringMatching(/^invalid output/), usage: { costUsd: 0.002, retries: 1 } })
  })

  it('does not retry a reply cut off by max_tokens, and records reasoning tokens', async () => {
    const fake = fakeFetch([{ content: '{"action":"ca', finish: 'length', reasoningTokens: 140, cost: 0.02 }])
    const res = await make(fake.fn).decide(obs, signal)
    expect(res).toMatchObject({ ok: false, kind: 'model', error: 'truncated: reply hit max_tokens', usage: { reasoningTokens: 140, costUsd: 0.02, retries: 0 } })
    expect(fake.requests).toHaveLength(1)
  })

  it('retries a refusal or empty reply without echoing an empty assistant turn', async () => {
    const fake = fakeFetch([{ content: null, refusal: 'I cannot help with gambling.' }, { content: valid }])
    const res = await make(fake.fn).decide(obs, signal)
    expect(res.ok).toBe(true)
    const retry = fake.requests[1]!.body.messages as Array<{ role: string; content: string }>
    expect(retry.map((m) => m.role)).toEqual(['system', 'user', 'user'])
    expect(retry.at(-1)!.content).toMatch(/the reply was a refusal/)
  })

  it('treats a provider error inside a 200 as an infrastructure failure, without a retry', async () => {
    const body = JSON.stringify({ error: { message: 'upstream overloaded' }, usage: { prompt_tokens: 400, completion_tokens: 0, cost: 0.0005 } })
    const fake = fakeFetch([{ body }])
    const res = await make(fake.fn).decide(obs, signal)
    expect(res).toMatchObject({ ok: false, kind: 'infra', error: 'provider error: upstream overloaded', usage: { costUsd: 0.0005, retries: 0 } })
    expect(fake.requests).toHaveLength(1)
  })

  it('returns an infrastructure failure (not a throw) on HTTP errors', async () => {
    const fake = fakeFetch([{ status: 500, body: 'upstream down' }])
    const res = await make(fake.fn).decide(obs, signal)
    expect(res).toMatchObject({ ok: false, kind: 'infra', error: expect.stringMatching(/OpenRouter 500/) })
  })
})
