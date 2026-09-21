import { describe, expect, it } from 'vitest'
import { createPlayers } from '../src/factory'
import { adaptLineup, fetchModelCatalog } from '../src/llm/preflight'

describe('createPlayers', () => {
  it('builds each kind from a line-up spec', () => {
    const players = createPlayers(
      [
        { id: 'jev', kind: 'jev', model: 'jev-1.13.0' },
        { id: 'pill', kind: 'llm', model: 'vendor/frontier-a' },
        { id: 'drip', kind: 'bot', bot: 'tag' },
        { id: 'nimbus', kind: 'mock' },
      ],
      { OPENROUTER_API_KEY: 'k', TYPESAFE_API_KEY: 'k' },
    )
    expect(players.map((p) => [p.id, p.kind, p.model])).toEqual([
      ['jev', 'jev', 'jev-1.13.0'],
      ['pill', 'llm', 'vendor/frontier-a'],
      ['drip', 'bot', 'bot/tag'],
      ['nimbus', 'mock', 'mock/llm'],
    ])
  })

  it('never exposes API keys through serialization or inspection', async () => {
    const { inspect } = await import('node:util')
    const players = createPlayers(
      [
        { id: 'jev', kind: 'jev', model: 'jev-1.13.0' },
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
    expect(() => createPlayers([{ id: 'jev', kind: 'jev', model: 'jev-1.13.0' }], {})).toThrow('jev: TYPESAFE_API_KEY is not set')
    expect(() => createPlayers([{ id: 'pill', kind: 'llm', model: 'm' }], {})).toThrow('pill: OPENROUTER_API_KEY is not set')
    expect(() => createPlayers([{ id: 'a', kind: 'mock' }, { id: 'a', kind: 'mock' }], {})).toThrow(/unique/)
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
        { id: 'jev', kind: 'jev', model: 'jev-1.13.0' },
        { id: 'a', kind: 'llm', model: 'vendor/reasoner' },
        { id: 'b', kind: 'llm', model: 'vendor/plain' },
        { id: 'c', kind: 'llm', model: 'vendor/reasoner', reasoning: 'low' },
      ],
      catalog,
    )
    expect(problems).toEqual(['b: "vendor/plain" has no strict structured output; using plain JSON replies'])
    expect(specs).toEqual([
      { id: 'jev', kind: 'jev', model: 'jev-1.13.0' },
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
