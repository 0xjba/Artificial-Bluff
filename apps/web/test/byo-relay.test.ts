import { describe, expect, it } from 'vitest'
import { RateLimiter, RELAY_MAX_BODY, relayTypeSafe, type RelayDeps } from '../lib/byo/relay'

type Seen = { url: string; headers: Record<string, string>; body: string }

function deps(reply: () => Response | Promise<Response> = () => new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json', 'x-typesafe-request-id': 'r1', 'set-cookie': 'a=b' } })) {
  const seen: Seen[] = []
  const d: RelayDeps = {
    upstream: 'https://api.typesafe.test',
    limiter: new RateLimiter(3),
    now: () => 1_000,
    fetch: (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: Object.fromEntries(new Headers(init.headers).entries()), body: String(init.body) })
      return reply()
    }) as unknown as typeof fetch,
  }
  return { d, seen }
}

const request = (headers: Record<string, string> = {}, body = '{"model":"jev-1.13.0"}') =>
  new Request('https://poker.example.com/api/typesafe/v1/systemone', {
    method: 'POST',
    headers: { host: 'poker.example.com', origin: 'https://poker.example.com', authorization: 'Bearer ts-key', 'content-type': 'application/json', cookie: 'session=1', 'x-forwarded-for': '203.0.113.9', ...headers },
    body,
  })

describe('TypeSafe relay', () => {
  it('forwards a Jev call with the visitor key, and only what TypeSafe needs', async () => {
    const { d, seen } = deps()
    const res = await relayTypeSafe(request(), ['v1', 'systemone'], d)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('{"ok":1}')
    expect(res.headers.get('x-typesafe-request-id')).toBe('r1')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(seen).toHaveLength(1)
    expect(seen[0]!.url).toBe('https://api.typesafe.test/v1/systemone')
    expect(seen[0]!.body).toBe('{"model":"jev-1.13.0"}')
    expect(seen[0]!.headers.authorization).toBe('Bearer ts-key')
    expect(seen[0]!.headers.cookie).toBeUndefined() // our cookies never leave
    expect(seen[0]!.headers['x-forwarded-for']).toBeUndefined()
  })

  it('refuses other paths, other sites, missing keys and big bodies', async () => {
    const { d, seen } = deps()
    expect((await relayTypeSafe(request(), ['v1', 'models'], d)).status).toBe(404)
    expect((await relayTypeSafe(request(), ['v1', 'systemone', '..', 'admin'], d)).status).toBe(404)
    expect((await relayTypeSafe(request({ origin: 'https://evil.example' }), ['v1', 'systemone'], d)).status).toBe(403)
    expect((await relayTypeSafe(request({ authorization: '' }), ['v1', 'systemone'], d)).status).toBe(401)
    expect((await relayTypeSafe(request({}, 'x'.repeat(RELAY_MAX_BODY + 1)), ['v1', 'systemone'], d)).status).toBe(413)
    expect(seen).toHaveLength(0)
  })

  it('rate-limits each address', async () => {
    const { d } = deps()
    for (let i = 0; i < 3; i++) expect((await relayTypeSafe(request(), ['v1', 'systemone'], d)).status).toBe(200)
    expect((await relayTypeSafe(request(), ['v1', 'systemone'], d)).status).toBe(429)
    expect((await relayTypeSafe(request({ 'x-forwarded-for': '198.51.100.1' }), ['v1', 'systemone'], d)).status).toBe(200)
    const limiter = new RateLimiter(1)
    expect(limiter.allow('a', 0)).toBe(true)
    expect(limiter.allow('a', 59_999)).toBe(false)
    expect(limiter.allow('a', 60_000)).toBe(true) // a new minute
  })

  it('passes TypeSafe errors through and reports an unreachable TypeSafe as 502', async () => {
    const { d } = deps(() => new Response('{"error":"bad key"}', { status: 401, headers: { 'content-type': 'application/json' } }))
    const res = await relayTypeSafe(request(), ['v1', 'systemone'], d)
    expect(res.status).toBe(401)
    expect(await res.text()).toContain('bad key')
    const { d: down } = deps(() => Promise.reject(new Error('ECONNREFUSED')))
    expect((await relayTypeSafe(request(), ['v1', 'systemone'], down)).status).toBe(502)
  })
})
