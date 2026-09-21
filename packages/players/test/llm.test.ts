import { createHand } from '@ab/engine'
import { describe, expect, it } from 'vitest'
import { LlmPlayer } from '../src/llm/llm-player'
import { OpenRouterError, chatCompletion } from '../src/llm/openrouter'
import { parseDecision } from '../src/llm/parse'
import { SYSTEM_PROMPT, responseFormat } from '../src/llm/prompt'
import { buildObservation } from '../src/observation'

const obs = buildObservation(
  createHand({ seats: [{ id: 'a', stack: 1000 }, { id: 'b', stack: 1000 }], buttonIndex: 0, smallBlind: 50, bigBlind: 100, seed: 2 }),
)
const signal = new AbortController().signal

/** A fake fetch that returns queued chat replies and records requests. */
function fakeFetch(replies: Array<{ status?: number; content?: string; cost?: number; body?: string }>) {
  const requests: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = []
  const fn = async (url: string, init?: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init!.body)), headers: init!.headers as Record<string, string> })
    const r = replies.shift()!
    const body =
      r.body ??
      JSON.stringify({
        model: 'vendor/model-2026',
        choices: [{ message: { content: r.content } }],
        usage: { prompt_tokens: 400, completion_tokens: 50, cost: r.cost ?? 0.001 },
      })
    return new Response(body, { status: r.status ?? 200 })
  }
  return { fn, requests }
}

const valid = JSON.stringify({ action: 'call', win_probability: 0.55, confidence: 0.7, reasoning: 'Decent hand, cheap price.' })

describe('parseDecision', () => {
  it('accepts a valid reply, including one wrapped in a code fence', () => {
    const r = parseDecision('```json\n' + valid + '\n```', obs)
    expect(r).toEqual({
      ok: true,
      decision: { optionId: 'call', winProbability: 0.55, confidence: 0.7, optionProbabilities: null, reasoning: 'Decent hand, cheap price.' },
    })
  })

  it('rejects unknown options, bad JSON and out-of-range probabilities with a specific error', () => {
    expect(parseDecision('nope', obs)).toEqual({ ok: false, error: 'reply was not valid JSON' })
    expect(parseDecision('{"action":"raise","win_probability":0.5,"confidence":0.5}', obs)).toMatchObject({ ok: false, error: expect.stringMatching(/must be one of: fold, call/) })
    expect(parseDecision('{"action":"call","win_probability":1.5e3,"confidence":0.5}', obs)).toMatchObject({ ok: false, error: expect.stringMatching(/between 0 and 1/) })
  })

  it('scales percentages and truncates long reasoning', () => {
    const r = parseDecision(JSON.stringify({ action: 'fold', win_probability: 70, confidence: 0.2, reasoning: 'x'.repeat(300) }), obs)
    expect(r.ok && r.decision.winProbability).toBe(0.7)
    expect(r.ok && r.decision.reasoning).toHaveLength(120)
  })
})

describe('prompt', () => {
  it('restricts the schema to this turn’s options and explains raise semantics', () => {
    const schema = responseFormat(obs) as { json_schema: { schema: { properties: { action: { enum: string[] } } } } }
    expect(schema.json_schema.schema.properties.action.enum).toEqual(obs.options.map((o) => o.id))
    expect(SYSTEM_PROMPT).toContain('"Bet X", "Raise to X" and "All-in X" mean your total bet this street becomes X')
  })
})

describe('chatCompletion', () => {
  it('throws OpenRouterError on non-2xx', async () => {
    const { fn } = fakeFetch([{ status: 402, body: '{"error":"insufficient credits"}' }])
    await expect(chatCompletion({ apiKey: 'k', fetch: fn }, { model: 'm', messages: [] })).rejects.toBeInstanceOf(OpenRouterError)
  })
})

describe('LlmPlayer', () => {
  const make = (fn: ReturnType<typeof fakeFetch>['fn']) =>
    new LlmPlayer({ id: 'pill', model: 'vendor/model', openrouter: { apiKey: 'test-key', fetch: fn } })

  it('sends the prompt with structured output, low temperature and reasoning off, and reports cost', async () => {
    const fake = fakeFetch([{ content: valid, cost: 0.0021 }])
    const res = await make(fake.fn).decide(obs, signal)
    expect(res).toMatchObject({ ok: true, model: 'vendor/model-2026', usage: { inputTokens: 400, outputTokens: 50, costUsd: 0.0021, retries: 0 } })
    const req = fake.requests[0]!
    expect(req.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(req.headers.Authorization).toBe('Bearer test-key')
    expect(req.body).toMatchObject({ model: 'vendor/model', temperature: 0.3, max_tokens: 150, reasoning: { effort: 'none' }, provider: { require_parameters: true } })
    expect((req.body.messages as Array<{ role: string }>).map((m) => m.role)).toEqual(['system', 'user'])
  })

  it('retries once with the specific error, summing usage', async () => {
    const fake = fakeFetch([{ content: '{"action":"shove"}', cost: 0.001 }, { content: valid, cost: 0.001 }])
    const res = await make(fake.fn).decide(obs, signal)
    expect(res).toMatchObject({ ok: true, usage: { inputTokens: 800, costUsd: 0.002, retries: 1 } })
    const retryMessages = fake.requests[1]!.body.messages as Array<{ role: string; content: string }>
    expect(retryMessages.at(-1)!.content).toMatch(/invalid: "action" must be one of/)
  })

  it('gives up after a second invalid reply, still reporting what it cost', async () => {
    const fake = fakeFetch([{ content: 'hmm' }, { content: 'still no' }])
    const res = await make(fake.fn).decide(obs, signal)
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/^invalid output/), usage: { costUsd: 0.002, retries: 1 } })
  })

  it('returns a failure (not a throw) on HTTP errors', async () => {
    const fake = fakeFetch([{ status: 500, body: 'upstream down' }])
    const res = await make(fake.fn).decide(obs, signal)
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/OpenRouter 500/) })
  })
})
