// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { authUrl, beginSignIn, challengeFor, exchangeCode, finishSignIn, forgetKeys, loadKeys, newVerifier, saveKeys } from '../lib/byo/keys'

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('keys', () => {
  it('keeps keys for this tab only, unless asked to remember them on this device', () => {
    expect(loadKeys()).toEqual({ openrouter: null, typesafe: null, remember: false })
    saveKeys({ openrouter: 'sk-or-1', typesafe: null, remember: false })
    expect(sessionStorage.length).toBe(1)
    expect(localStorage.length).toBe(0)
    expect(loadKeys()).toEqual({ openrouter: 'sk-or-1', typesafe: null, remember: false })
    saveKeys({ openrouter: 'sk-or-1', typesafe: 'ts-1', remember: true })
    expect(localStorage.length).toBe(1)
    expect(sessionStorage.length).toBe(0)
    expect(loadKeys()).toEqual({ openrouter: 'sk-or-1', typesafe: 'ts-1', remember: true })
    forgetKeys()
    expect(loadKeys()).toEqual({ openrouter: null, typesafe: null, remember: false })
    expect(localStorage.length + sessionStorage.length).toBe(0)
  })
})

describe('Sign in with OpenRouter (OAuth PKCE)', () => {
  it('makes an S256 challenge from a random verifier', async () => {
    const v = newVerifier()
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(newVerifier()).not.toBe(v)
    expect(await challengeFor(v)).toBe(createHash('sha256').update(v).digest('base64url'))
  })

  it('builds the authorisation link', () => {
    const url = new URL(authUrl('https://poker.example.com/play', 'abc'))
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth')
    expect(Object.fromEntries(url.searchParams)).toEqual({ callback_url: 'https://poker.example.com/play', code_challenge: 'abc', code_challenge_method: 'S256' })
  })

  it('exchanges the code for a key, with the verifier kept for this tab', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) })
      return { ok: true, json: async () => ({ key: 'sk-or-new' }) }
    }) as unknown as typeof fetch
    const link = await beginSignIn('https://poker.example.com/play')
    expect(new URL(link).searchParams.get('code_challenge')).toBe(await challengeFor(sessionStorage.getItem('artificialBluff.pkce')!))
    expect(await finishSignIn('the-code', fake)).toBe('sk-or-new')
    expect(calls[0]).toMatchObject({ url: 'https://openrouter.ai/api/v1/auth/keys', body: { code: 'the-code', code_challenge_method: 'S256' } })
    expect(sessionStorage.getItem('artificialBluff.pkce')).toBeNull() // used once
    await expect(finishSignIn('again', fake)).rejects.toThrow(/start/)
    const refused = (async () => ({ ok: false, status: 403 })) as unknown as typeof fetch
    await expect(exchangeCode('c', 'v', refused)).rejects.toThrow(/403/)
  })
})
