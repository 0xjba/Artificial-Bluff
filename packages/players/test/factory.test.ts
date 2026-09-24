import { describe, expect, it } from 'vitest'
import { createHand } from '@ab/engine'
import { createPlayers } from '../src/factory'
import { offlineTypeSafeFetch } from '../src/jev/offline'
import { buildObservation } from '../src/observation'
import { adaptLineup, fetchModelCatalog } from '../src/llm/preflight'

describe('createPlayers', () => {
  it('builds each kind from a line-up spec', () => {
    const players = createPlayers(
      [
        { id: 'hex', kind: 'jev', model: 'jev-1.13.0' },
        { id: 'pill', kind: 'llm', model: 'vendor/frontier-a' },
        { id: 'drip', kind: 'bot', bot: 'tag' },
        { id: 'nimbus', kind: 'mock' },
      ],
      { OPENROUTER_API_KEY: 'k', TYPESAFE_API_KEY: 'k' },
    )
    expect(players.map((p) => [p.id, p.kind, p.model])).toEqual([
      ['hex', 'jev', 'jev-1.13.0'],
      ['pill', 'llm', 'vendor/frontier-a'],
      ['drip', 'bot', 'bot/tag'],
      ['nimbus', 'mock', 'mock/llm'],
    ])
  })

  it('never exposes API keys through serialization or inspection', async () => {
    const { inspect } = await import('node:util')
    const players = createPlayers(
      [
        { id: 'hex', kind: 'jev', model: 'jev-1.13.0' },
        { id: 'pill', kind: 'llm', model: 'vendor/frontier-a' },
      ],
      { OPENROUTER_API_KEY: 'sk-or-secret-123', TYPESAFE_API_KEY: 'ts-secret-456' },
    )
    for (const p of players) {
      for (const text of [JSON.stringify(p), inspect(p, { depth: 10 })]) {
        expect(text).not.toContain('secret')
      }
    }
  })

  it('fails fast with a clear message when a key is missing, and rejects duplicate ids', () => {
    expect(() => createPlayers([{ id: 'hex', kind: 'jev', model: 'jev-1.13.0' }], {})).toThrow('hex: TYPESAFE_API_KEY is not set')
    expect(() => createPlayers([{ id: 'pill', kind: 'llm', model: 'm' }], {})).toThrow('pill: OPENROUTER_API_KEY is not set')
    expect(() => createPlayers([{ id: 'a', kind: 'mock' }, { id: 'a', kind: 'mock' }], {})).toThrow(/unique/)
  })
})

describe('Jev seats', () => {
  const obs = buildObservation(createHand({ seats: [{ id: 'a', stack: 1000 }, { id: 'b', stack: 1000 }], buttonIndex: 0, smallBlind: 50, bigBlind: 100, seed: 2 }))
  const signal = new AbortController().signal

  it('builds the decomposed mode when the spec asks for it', async () => {
    const bodies: Array<{ questions: Record<string, unknown> }> = []
    const offline = offlineTypeSafeFetch()
    const spy = (url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init!.body)))
      return offline(url, init)
    }
    const [jev] = createPlayers([{ id: 'hex', kind: 'jev', model: 'jev-1.13.0', mode: 'decomposed' }], { TYPESAFE_API_KEY: 'k' }, spy)
    expect(await jev!.decide(obs, signal)).toMatchObject({ ok: true })
    expect(Object.keys(bodies[0]!.questions).sort()).toEqual(['strength', 'win'])
  })

  it('plays an offline Jev with no key and no network, for free rehearsals', async () => {
    const [choiceJev, decomposed] = createPlayers(
      [
        { id: 'hex', kind: 'jev', model: 'mock/jev-1.13.0', offline: true },
        { id: 'pill', kind: 'jev', model: 'mock/jev-1.13.0', mode: 'decomposed', offline: true },
      ],
      {},
    )
    for (const p of [choiceJev!, decomposed!]) {
      const res = await p.decide(obs, signal)
      expect(res).toMatchObject({ ok: true })
      expect(obs.options.map((o) => o.id)).toContain(res.ok && res.decision.optionId)
    }
  })
})

describe('the offline TypeSafe stand-in', () => {
  const ask = async (questions: Record<string, unknown>, state: unknown = { hole: ['Ah', 'Kd'] }) => {
    const res = await offlineTypeSafeFetch()('https://offline/v1/system-one', { method: 'POST', body: JSON.stringify({ model: 'm', state, questions }) })
    return (await res.json()) as { answers: Record<string, Record<string, unknown>>; usage: { input_tokens: number } }
  }

  it('answers every question type in the API\'s shape, the same way for the same request', async () => {
    const qs = {
      a: { type: 'choice', instructions: 'x', criteria: { fold: 'Fold', call: 'Call' } },
      w: { type: 'noul', instructions: 'y' },
      s: { type: 'score', instructions: 'z', criteria: ['low', 'mid', 'high'] },
    }
    const one = await ask(qs)
    expect(one).toEqual(await ask(qs))
    expect(['fold', 'call']).toContain(one.answers.a!.choice)
    const p = one.answers.a!.probabilities as Record<string, number>
    expect(p.fold! + p.call!).toBeCloseTo(1, 9)
    expect(one.answers.w!.noul).toBeGreaterThanOrEqual(0)
    expect(one.answers.w!.noul).toBeLessThanOrEqual(1)
    expect(one.answers.s!.score).toBeGreaterThanOrEqual(0)
    expect(one.answers.s!.score).toBeLessThanOrEqual(2)
    expect(one.usage.input_tokens).toBeGreaterThan(0)
  })
})

describe('preflight', () => {
  const catalogFetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          { id: 'vendor/reasoner', supported_parameters: ['reasoning', 'structured_outputs', 'temperature'] },
          { id: 'vendor/plain', supported_parameters: ['response_format', 'temperature'] },
          { id: 'vendor/bare', supported_parameters: [] },
        ],
      }),
    )

  it('fills in request flags from what each model supports, keeping explicit settings', async () => {
    const catalog = await fetchModelCatalog(catalogFetch)
    const { specs, problems } = adaptLineup(
      [
        { id: 'hex', kind: 'jev', model: 'jev-1.13.0' },
        { id: 'a', kind: 'llm', model: 'vendor/reasoner' },
        { id: 'b', kind: 'llm', model: 'vendor/plain' },
        { id: 'c', kind: 'llm', model: 'vendor/reasoner', reasoning: 'low' },
      ],
      catalog,
    )
    expect(problems).toEqual(['b: "vendor/plain" has no strict structured output; using plain JSON replies'])
    expect(specs).toEqual([
      { id: 'hex', kind: 'jev', model: 'jev-1.13.0' },
      { id: 'a', kind: 'llm', model: 'vendor/reasoner', structuredOutput: true, reasoning: 'off', sendTemperature: true },
      { id: 'b', kind: 'llm', model: 'vendor/plain', structuredOutput: false, reasoning: 'omit', sendTemperature: true },
      { id: 'c', kind: 'llm', model: 'vendor/reasoner', structuredOutput: true, reasoning: 'low', sendTemperature: true },
    ])
  })

  it('keeps explicit structuredOutput and sendTemperature settings', async () => {
    const catalog = await fetchModelCatalog(catalogFetch)
    const { specs } = adaptLineup([{ id: 'a', kind: 'llm', model: 'vendor/reasoner', structuredOutput: false, sendTemperature: false }], catalog)
    expect(specs[0]).toMatchObject({ structuredOutput: false, sendTemperature: false, reasoning: 'off' })
  })

  it('fails clearly when the catalog cannot be fetched', async () => {
    await expect(fetchModelCatalog(async () => new Response('down', { status: 503 }))).rejects.toThrow('model catalog: HTTP 503')
  })

  it('reports unknown models and models without structured output', async () => {
    const catalog = await fetchModelCatalog(catalogFetch)
    const { problems } = adaptLineup(
      [
        { id: 'x', kind: 'llm', model: 'vendor/typo' },
        { id: 'y', kind: 'llm', model: 'vendor/bare' },
      ],
      catalog,
    )
    expect(problems).toEqual([
      'x: model "vendor/typo" is not in the OpenRouter catalog',
      'y: "vendor/bare" has no strict structured output; using plain JSON replies',
    ])
  })
})
