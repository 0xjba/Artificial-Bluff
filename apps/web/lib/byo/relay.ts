/**
 * The TypeSafe relay, for Jev seats at tables that run in a visitor's browser. TypeSafe's API does not
 * accept browser (cross-origin) calls yet, so the page calls this route instead and it forwards the
 * request with the visitor's own key. Stateless: the key is forwarded per request and never stored or
 * logged. Only Jev calls are allowed (POST /v1/systemone), from our own pages, small bodies, and a
 * per-address rate limit. Remove once TypeSafe allows browser calls.
 */
export const TYPESAFE_API = 'https://api.typesafe.ai'
export const RELAY_MAX_BODY = 64 * 1024
/** Calls per minute per address: a game makes one Jev call every few seconds. */
export const RELAY_PER_MINUTE = 120
export const RELAY_TIMEOUT_MS = 60_000

/** Paths the relay forwards (joined route segments): only Jev's systemOne calls. */
const ALLOWED = /^v1\/systemone(\/[a-z0-9_-]+)*$/
/** Response headers passed back to the page. */
const PASS_BACK = ['content-type', 'retry-after', 'retry-after-ms', 'x-typesafe-request-id']

/** Fixed one-minute windows per key (the client address); old windows are dropped as they pass. */
export class RateLimiter {
  readonly #windows = new Map<string, { minute: number; count: number }>()
  constructor(readonly perMinute: number) {}

  allow(key: string, now: number): boolean {
    const minute = Math.floor(now / 60_000)
    if (this.#windows.size > 10_000) for (const [k, w] of this.#windows) if (w.minute !== minute) this.#windows.delete(k)
    const w = this.#windows.get(key)
    if (!w || w.minute !== minute) {
      this.#windows.set(key, { minute, count: 1 })
      return true
    }
    w.count++
    return w.count <= this.perMinute
  }
}

export interface RelayDeps {
  fetch: typeof fetch
  limiter: RateLimiter
  now: () => number
  upstream: string
}

export const relayDeps: RelayDeps = { fetch: (...a) => fetch(...a), limiter: new RateLimiter(RELAY_PER_MINUTE), now: Date.now, upstream: TYPESAFE_API }

const json = (status: number, error: string) => Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } })

export async function relayTypeSafe(req: Request, segments: string[], deps: RelayDeps): Promise<Response> {
  const path = segments.join('/')
  if (!ALLOWED.test(path)) return json(404, 'not a Jev call')
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (origin && (!host || new URL(origin).host !== host)) return json(403, 'calls from other sites are not relayed')
  const auth = req.headers.get('authorization') ?? ''
  if (!/^Bearer \S+$/.test(auth)) return json(401, 'a TypeSafe key is needed')
  if (Number(req.headers.get('content-length') ?? 0) > RELAY_MAX_BODY) return json(413, 'request too large')
  const body = await req.text()
  if (body.length > RELAY_MAX_BODY) return json(413, 'request too large')
  const address = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'local'
  if (!deps.limiter.allow(address, deps.now())) return json(429, 'too many Jev calls; slow down')

  let res: Response
  try {
    res = await deps.fetch(`${deps.upstream}/${path}`, {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'artificialBluff-relay' },
      body,
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    })
  } catch {
    return json(502, 'TypeSafe could not be reached')
  }
  const headers = new Headers({ 'cache-control': 'no-store' })
  for (const h of PASS_BACK) {
    const v = res.headers.get(h)
    if (v) headers.set(h, v)
  }
  return new Response(await res.arrayBuffer(), { status: res.status, headers })
}
