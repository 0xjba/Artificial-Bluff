import type { CatalogModel } from '@ab/players'
import type { FeedMessage } from '@ab/server'
import { describe, expect, it } from 'vitest'
import { initialFeed, reduceFeed } from '../lib/feed'
import type { ModelOption, SeatChoice } from '../lib/byo/models'
import { checkSetup, DEFAULT_SEATS, LocalTable, seatId, type TableSetup } from '../lib/byo/table'

type Call = { url: string; auth: string | null; referer: string | null }

/** OpenRouter answers every call (a fold, costing `cost`); TypeSafe fails, so Jev falls back to check-or-fold. */
function fakeNetwork(cost = 0.001) {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers)
    calls.push({ url, auth: headers.get('authorization'), referer: headers.get('http-referer') })
    if (url.startsWith('https://openrouter.ai/')) {
      const content = JSON.stringify({ action: 'fold', win_probability: 0.3, confidence: 0.5, reasoning: 'folding' })
      return Response.json({ model: 'acme/m', choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 800, completion_tokens: 20, cost } })
    }
    return new Response('{"error":"unavailable"}', { status: 503, headers: { 'content-type': 'application/json' } })
  }) as typeof globalThis.fetch
  return { calls, fetch }
}

const catalog = new Map<string, CatalogModel>([['acme/m', { id: 'acme/m', supported_parameters: ['structured_outputs', 'temperature'] }]])
const models = new Map<string, ModelOption>([['acme/m', { id: 'acme/m', name: 'Acme M', decisionUsd: 0.001, featured: false }]])
const seats: SeatChoice[] = [{ kind: 'jev' }, { kind: 'llm', model: 'acme/m' }, { kind: 'bot' }, { kind: 'bot' }, { kind: 'bot' }]
const setup = (over: Partial<TableSetup> = {}): TableSetup => ({ seats, openrouterKey: 'or-key', typesafeKey: 'ts-key', budgetUsd: 5, ...over })
const deps = (fetch: typeof globalThis.fetch) => ({ catalog, relayBase: 'https://site.test/api/typesafe', referer: 'https://site.test', fetch, seed: 'fixed', paceMs: 0 })

describe('a table in the browser', () => {
  it('says what is missing before it can start', () => {
    expect(checkSetup(setup(), models)).toEqual([])
    expect(checkSetup(setup({ openrouterKey: null, typesafeKey: null, budgetUsd: 50 }), models)).toEqual([
      'connect OpenRouter (or paste a key) for the model seats',
      'add a TypeSafe key for the Jev seat',
      'the spending cap must be between $0.1 and $20',
    ])
    expect(checkSetup(setup({ seats: [{ kind: 'bot' }, { kind: 'jev' }, { kind: 'llm', model: 'nope/x' }, { kind: 'bot' }, { kind: 'bot' }] }), models)).toEqual([
      'Jev can only play the first seat',
      'seat 3: choose a model from the list',
    ])
    expect(checkSetup(setup({ seats: [{ kind: 'bot' }, { kind: 'bot' }, { kind: 'bot' }, { kind: 'bot' }, { kind: 'bot' }], openrouterKey: null, typesafeKey: null }), models)).toEqual([]) // a free all-bot table
    expect(DEFAULT_SEATS[0]).toEqual({ kind: 'jev' })
    expect([seatId({ kind: 'jev' }, 0), seatId({ kind: 'bot' }, 0), seatId({ kind: 'bot' }, 3)]).toEqual(['jev', 'pebble', 'drip'])
  })

  it('plays a whole game: models straight to OpenRouter, Jev through our relay, the feed a spectator screen understands', async () => {
    const net = fakeNetwork()
    const messages: FeedMessage[] = []
    const table = new LocalTable(setup(), deps(net.fetch), (m) => messages.push(m))
    expect(await table.start()).toBe('ended')

    const toOpenRouter = net.calls.filter((c) => c.url === 'https://openrouter.ai/api/v1/chat/completions')
    const toRelay = net.calls.filter((c) => c.url === 'https://site.test/api/typesafe/v1/systemone')
    expect(toOpenRouter.length).toBeGreaterThan(0)
    expect(toRelay.length).toBeGreaterThan(0)
    expect(toOpenRouter.length + toRelay.length).toBe(net.calls.length) // nothing else is called
    expect(toOpenRouter.every((c) => c.auth === 'Bearer or-key' && c.referer === 'https://site.test')).toBe(true)
    expect(toRelay.every((c) => c.auth === 'Bearer ts-key')).toBe(true) // each key goes only to its own service
    expect(table.spentUsd()).toBeCloseTo(toOpenRouter.length * 0.001, 9)

    expect(messages[0]).toMatchObject({ type: 'snapshot', channel: { mode: 'live', gameId: table.gameId } })
    expect(messages.some((m) => m.type === 'equity')).toBe(true)
    let state = initialFeed()
    for (const m of messages) state = reduceFeed(state, m, (id) => id.toUpperCase())
    expect(state.view.status).toBe('ended')
    expect(state.view.seats.map((s) => s.playerId)).toEqual(['jev', 'pill', 'block', 'drip', 'nimbus'])
  })

  it('ends at the spending cap', async () => {
    const net = fakeNetwork(0.05)
    const messages: FeedMessage[] = []
    const table = new LocalTable(setup({ budgetUsd: 0.1 }), deps(net.fetch), (m) => messages.push(m))
    await table.start()
    const end = [...messages].reverse().find((m) => m.type === 'event' && m.event.type === 'game_ended')
    expect(end).toMatchObject({ event: { reason: 'budget_cap' } })
    expect(table.spentUsd()).toBeLessThan(0.1 + 0.05 * 2)
  })

  it('stops after the hand in progress', async () => {
    const net = fakeNetwork()
    const messages: FeedMessage[] = []
    const table = new LocalTable(setup(), deps(net.fetch), (m) => messages.push(m))
    const done = table.start()
    table.stop()
    expect(await done).toBe('interrupted')
    const hands = messages.filter((m) => m.type === 'event' && m.event.type === 'hand_started').length
    expect(hands).toBe(1)
  })
})
