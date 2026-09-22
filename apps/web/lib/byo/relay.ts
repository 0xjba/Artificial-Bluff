/**
 * The TypeSafe relay, for Jev seats at tables that run in a visitor's browser. TypeSafe's API does not
 * accept browser (cross-origin) calls yet, so the page calls this route instead and it forwards the
 * request with the visitor's own key. Stateless: the key is forwarded per request and never stored or
 * logged. Only Jev calls are allowed (POST /v1/systemone), from our own pages, small bodies, and
 * per-client and total rate limits. Remove once TypeSafe allows browser calls.
 */
export const TYPESAFE_API = 'https://api.typesafe.ai'
export const RELAY_MAX_BODY = 64 * 1024
/** Calls per minute per client: a game makes one Jev call every few seconds. */
export const RELAY_PER_MINUTE = 120
/** Calls per minute in total, and clients tracked per minute: beyond these the relay says "slow down". */
export const RELAY_TOTAL_PER_MINUTE = 3_000
export const RELAY_MAX_CLIENTS = 20_000
export const RELAY_TIMEOUT_MS = 60_000

/** The one path the relay forwards (joined route segments): Jev's systemOne call. */
const ALLOWED = /^v1\/systemone$/
/** Response headers passed back to the page. */
const PASS_BACK = ['content-type', 'retry-after', 'retry-after-ms', 'x-typesafe-request-id']

/**
 * The rate-limit key for a client address: IPv4 as is (also when IPv4-mapped), IPv6 by its /64, since
 * one host usually holds a whole /64 and could otherwise rotate addresses.
 */
export function clientKey(address: string): string {
  const a = address.trim()
  if (!a) return 'local'
  if (a.includes('.')) return a.slice(a.lastIndexOf(':') + 1)
  const [head = '', tail] = a.toLowerCase().split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`
}

/**
 * Per-minute call counts per client, plus a ceiling on calls in total and on clients tracked. The map
 * is cleared when a new minute starts, so it never holds more than one minute of clients.
 */
export class RateLimiter {
  readonly #counts = new Map<string, number>()
  #minute = -1
  #total = 0
  readonly #maxClients: number
  readonly #perMinuteTotal: number

  constructor(
    readonly perMinute: number,
    limits: { maxClients?: number; perMinuteTotal?: number } = {},
  ) {
    this.#maxClients = limits.maxClients ?? RELAY_MAX_CLIENTS
    this.#perMinuteTotal = limits.perMinuteTotal ?? RELAY_TOTAL_PER_MINUTE
  }

  allow(key: string, now: number): boolean {
    const minute = Math.floor(now / 60_000)
    if (minute !== this.#minute) {
      this.#minute = minute
      this.#counts.clear()
      this.#total = 0
    }
    const count = this.#counts.get(key) ?? 0
    if (count === 0 && this.#counts.size >= this.#maxClients) return false
    if (count >= this.perMinute || this.#total >= this.#perMinuteTotal) return false
    this.#counts.set(key, count + 1)
    this.#total++
    return true
  }
}

/** The body as text, or null once it passes `max` bytes (a streamed body is not read further). */
async function readLimited(req: Request, max: number): Promise<string | null> {
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    all.set(c, at)
    at += c.byteLength
  }
  return new TextDecoder().decode(all)
}

/** Whether a browser `Origin` header names this site (a missing one is allowed: not a browser page). */
function sameSite(origin: string | null, host: string | null): boolean {
  if (origin === null) return true
  try {
    return host !== null && new URL(origin).host === host
  } catch {
    return false // e.g. "null" from sandboxed frames
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
  // Stops other sites' pages from using the relay (curl can omit Origin: the limits below cover that).
  if (!sameSite(req.headers.get('origin'), req.headers.get('x-forwarded-host') ?? req.headers.get('host'))) return json(403, 'calls from other sites are not relayed')
  const auth = req.headers.get('authorization') ?? ''
  if (!/^Bearer \S+$/.test(auth)) return json(401, 'a TypeSafe key is needed')
  if (Number(req.headers.get('content-length') ?? 0) > RELAY_MAX_BODY) return json(413, 'request too large')
  // Behind Caddy, X-Forwarded-For is set by Caddy (it replaces what clients send).
  const address = clientKey((req.headers.get('x-forwarded-for') ?? '').split(',')[0]!)
  if (!deps.limiter.allow(address, deps.now())) return json(429, 'too many Jev calls; slow down')
  const body = await readLimited(req, RELAY_MAX_BODY)
  if (body === null) return json(413, 'request too large')

  let res: Response
  try {
    res = await deps.fetch(`${deps.upstream}/${path}`, {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'artificialBluff-relay' },
      body,
      redirect: 'error', // the key must never follow a redirect elsewhere
      // Stop when the page gives up (its decision timed out), so no one pays for an answer nobody reads.
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(RELAY_TIMEOUT_MS)]),
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
