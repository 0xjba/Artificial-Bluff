import { describe, expect, it } from 'vitest'
import { DECISIONS_PER_SEAT, decisionUsd, estimateGameUsd, FEATURED, jevDecisionUsd, loadCatalog, supportedModels, type CatalogEntry } from '../lib/byo/models'

const entry = (id: string, prompt: string, completion: string, params = ['structured_outputs', 'response_format', 'temperature'], extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id,
  name: id.toUpperCase(),
  pricing: { prompt, completion },
  supported_parameters: params,
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  ...extra,
})

const catalog: CatalogEntry[] = [
  entry('anthropic/claude-sonnet-5', '0.000003', '0.000015'), // featured
  entry('acme/cheap', '0.0000001', '0.0000004'),
  entry('acme/json-only', '0.0000001', '0.0000004', ['response_format']), // no strict structured outputs
  entry('acme/cheap:free', '0', '0'), // free variants are rate-limited: excluded
  entry('acme/cheap:batch', '0.00000005', '0.0000002'), // batch variants are asynchronous: excluded
  entry('~acme/latest', '0.0000001', '0.0000004'), // moving aliases: excluded
  entry('openrouter/auto', '-1', '-1'), // router, priced per call: excluded
  entry('acme/huge', '0.00005', '0.0002'), // over the per-decision ceiling: excluded
  entry('acme/image', '0.0000001', '0.0000004', undefined, { architecture: { input_modalities: ['image'], output_modalities: ['image'] } }),
]

describe('supported OpenRouter models', () => {
  it('keeps text models with strict structured outputs at a sane price, featured first', () => {
    const models = supportedModels(catalog)
    expect(models.map((m) => m.id)).toEqual(['anthropic/claude-sonnet-5', 'acme/cheap'])
    expect(models[0]).toMatchObject({ featured: true, name: 'ANTHROPIC/CLAUDE-SONNET-5' })
    expect(models[1]!.featured).toBe(false)
    expect(models[0]!.decisionUsd).toBeCloseTo(800 * 0.000003 + 80 * 0.000015, 12)
    expect(FEATURED).toContain('meta-llama/llama-4-maverick')
  })

  it('estimates a game: every paid seat up to DECISIONS_PER_SEAT decisions', () => {
    const models = new Map(supportedModels(catalog).map((m) => [m.id, m]))
    const usd = estimateGameUsd([{ kind: 'jev' }, { kind: 'llm', model: 'acme/cheap' }, { kind: 'bot' }], models)
    expect(usd).toBeCloseTo(DECISIONS_PER_SEAT * (jevDecisionUsd() + decisionUsd(catalog[1]!)), 12)
    expect(estimateGameUsd([{ kind: 'llm', model: 'nope/unknown' }], models)).toBe(0)
  })

  it('loads the public catalog', async () => {
    const urls: string[] = []
    const fake = (async (url: string) => {
      urls.push(url)
      return { ok: true, json: async () => ({ data: catalog }) }
    }) as unknown as typeof fetch
    expect(await loadCatalog(fake)).toHaveLength(catalog.length)
    expect(urls).toEqual(['https://openrouter.ai/api/v1/models'])
    const failing = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch
    await expect(loadCatalog(failing)).rejects.toThrow(/503/)
  })
})
