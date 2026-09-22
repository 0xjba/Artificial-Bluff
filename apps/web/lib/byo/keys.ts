/**
 * The visitor's own API keys. They stay in this browser: in this tab's session storage by default,
 * or in local storage when the visitor asks to be remembered on this device. They are sent only to
 * OpenRouter (directly) and, for a Jev seat, to TypeSafe through our relay (see relay.ts).
 */
export interface Keys {
  openrouter: string | null
  typesafe: string | null
  /** Kept in local storage (survives closing the browser) rather than this tab's session. */
  remember: boolean
}

const KEYS = 'artificialBluff.keys'
const PKCE = 'artificialBluff.pkce'
const NONE: Keys = { openrouter: null, typesafe: null, remember: false }

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null // storage blocked: keys live only in memory for this page
  }
}

export function loadKeys(): Keys {
  for (const kind of ['local', 'session'] as const) {
    try {
      const raw = storage(kind)?.getItem(KEYS)
      if (!raw) continue
      const k = JSON.parse(raw) as Partial<Keys>
      return { openrouter: k.openrouter || null, typesafe: k.typesafe || null, remember: kind === 'local' }
    } catch {
      // unreadable entry: ignore it
    }
  }
  return { ...NONE }
}

export function saveKeys(keys: Keys): void {
  const value = JSON.stringify({ openrouter: keys.openrouter, typesafe: keys.typesafe })
  try {
    storage(keys.remember ? 'session' : 'local')?.removeItem(KEYS)
    storage(keys.remember ? 'local' : 'session')?.setItem(KEYS, value)
  } catch {
    // not persisted
  }
}

export function forgetKeys(): void {
  try {
    storage('local')?.removeItem(KEYS)
    storage('session')?.removeItem(KEYS)
  } catch {
    // nothing stored
  }
}

// ---- Sign in with OpenRouter (OAuth PKCE: https://openrouter.ai/docs/use-cases/oauth-pkce) ----

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A random PKCE code verifier (32 bytes, base64url). */
export function newVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

/** The S256 code challenge for a verifier. */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

export function authUrl(callbackUrl: string, challenge: string): string {
  const url = new URL('https://openrouter.ai/auth')
  url.searchParams.set('callback_url', callbackUrl)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

/** Trades the code OpenRouter sent back for a key the visitor controls. */
export async function exchangeCode(code: string, verifier: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  })
  if (!res.ok) throw new Error(`OpenRouter sign-in failed: HTTP ${res.status}`)
  const body = (await res.json()) as { key?: string }
  if (!body.key) throw new Error('OpenRouter sign-in failed: no key returned')
  return body.key
}

/** Starts a sign-in: keeps a fresh verifier for this tab and returns the link to send the visitor to. */
export async function beginSignIn(callbackUrl: string): Promise<string> {
  const verifier = newVerifier()
  storage('session')?.setItem(PKCE, verifier)
  return authUrl(callbackUrl, await challengeFor(verifier))
}

/** Finishes a sign-in on return (`?code=` in the URL): the verifier is used once. */
export async function finishSignIn(code: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const verifier = storage('session')?.getItem(PKCE)
  if (!verifier) throw new Error('sign-in expired: start it again from this tab')
  storage('session')?.removeItem(PKCE)
  return exchangeCode(code, verifier, fetchImpl)
}
