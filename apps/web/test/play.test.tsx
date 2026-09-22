// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayScreen } from '../components/play/PlayScreen'
import type { CatalogEntry } from '../lib/byo/models'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const model = (id: string): CatalogEntry => ({
  id,
  name: id,
  pricing: { prompt: '0.000001', completion: '0.000002' },
  supported_parameters: ['structured_outputs'],
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
})
const catalog = ['anthropic/claude-sonnet-5', 'openai/gpt-5.6-sol', 'google/gemini-3.8-flash', 'meta-llama/llama-4-maverick', 'acme/other'].map(model)

let root: Root
let host: HTMLDivElement
const settle = () => act(async () => await new Promise((r) => setTimeout(r, 0)))
const text = () => host.textContent ?? ''
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement | undefined
function choose(label: string, value: string) {
  const el = host.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement | HTMLInputElement
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

let catalogUp = true
const exchanged: string[] = []
async function mount(paceMs = 0) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<PlayScreen paceMs={paceMs} />))
  await settle()
}

beforeEach(async () => {
  catalogUp = true
  exchanged.length = 0
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url) === 'https://openrouter.ai/api/v1/models') return catalogUp ? { ok: true, json: async () => ({ data: catalog }) } : { ok: false, status: 503 }
    if (String(url) === 'https://openrouter.ai/api/v1/auth/keys') {
      exchanged.push(String(init?.body))
      return { ok: true, json: async () => ({ key: 'sk-or-from-signin' }) }
    }
    throw new Error(`unexpected call to ${url}`)
  })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
})
afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

describe('/play', () => {
  it('starts with Jev and four models, and says what is missing', async () => {
    await mount()
    expect(text()).toContain('JEV')
    expect((host.querySelector('[aria-label="seat 2 model"]') as HTMLInputElement).value).toBe('anthropic/claude-sonnet-5')
    expect(text()).toContain('connect OpenRouter (or paste a key) for the model seats')
    expect(text()).toContain('add a TypeSafe key for the Jev seat')
    expect(text()).toContain('OPENROUTER KEY NEEDED')
    expect(text()).toContain('TYPESAFE KEY NEEDED') // the Jev relay is explained next to the TypeSafe key
    expect(button('Deal the first hand')!.disabled).toBe(true)
    choose('OpenRouter key', 'sk-or-test')
    choose('TypeSafe key', 'ts-test')
    expect(button('Deal the first hand')!.disabled).toBe(false)
    expect(host.querySelectorAll('#play-models option')).toHaveLength(5)
  })

  it('runs a free all-bot table on the broadcast screen, keeping no keys', async () => {
    await mount()
    for (let i = 1; i <= 5; i++) choose(`seat ${i} player`, 'bot')
    expect(text()).toContain('PEBBLE') // seat 1 without Jev
    expect(text()).not.toContain('TYPESAFE')
    expect(text()).toContain('≈ $0')
    await act(async () => button('Deal the first hand')!.click())
    for (let i = 0; i < 50 && !button('New table'); i++) await settle()
    expect(host.querySelector('.broadcast')).not.toBeNull()
    expect(host.querySelectorAll('.log li').length).toBeGreaterThan(0)
    expect(button('New table')).toBeDefined()
    expect(text()).toContain('spent ≈ $0 of $1')
    expect(localStorage.length).toBe(0)
    act(() => button('New table')!.click())
    expect(text()).toContain('Deal your own line-up')
  })

  it('still runs tables without model seats when the model list fails, and can retry it', async () => {
    catalogUp = false
    await mount()
    expect(text()).toContain("Couldn't load OpenRouter's model list")
    expect(text()).toContain("OpenRouter's model list didn't load")
    for (let i = 2; i <= 5; i++) choose(`seat ${i} player`, 'bot')
    choose('TypeSafe key', 'ts-test')
    expect(button('Deal the first hand')!.disabled).toBe(false) // Jev and bots need no model list
    catalogUp = true
    await act(async () => button('Retry')!.click())
    await settle()
    expect(host.querySelectorAll('#play-models option')).toHaveLength(5)
  })

  it('saves or forgets keys as soon as they or the Remember choice change', async () => {
    await mount()
    choose('OpenRouter key', 'sk-or-test')
    expect(sessionStorage.getItem('artificialBluff.keys')).toContain('sk-or-test')
    expect(localStorage.length).toBe(0)
    act(() => (host.querySelector('.remember input') as HTMLInputElement).click())
    expect(localStorage.getItem('artificialBluff.keys')).toContain('sk-or-test')
    expect(sessionStorage.getItem('artificialBluff.keys')).toBeNull()
    act(() => (host.querySelector('.remember input') as HTMLInputElement).click())
    expect(localStorage.length).toBe(0) // unticked: nothing left on the device
    act(() => button('Forget my keys')!.click())
    expect(sessionStorage.getItem('artificialBluff.keys')).toBeNull()
    expect((host.querySelector('[aria-label="OpenRouter key"]') as HTMLInputElement).value).toBe('')
  })

  it('finishes a sign-in on return from OpenRouter, keeping the seats chosen before it', async () => {
    sessionStorage.setItem('artificialBluff.pkce', 'the-verifier')
    sessionStorage.setItem('artificialBluff.playDraft', JSON.stringify({ seats: [{ kind: 'jev' }, { kind: 'bot' }, { kind: 'bot' }, { kind: 'bot' }, { kind: 'llm', model: 'acme/other' }], budgetUsd: 2.5 }))
    window.history.replaceState(null, '', '/play?code=abc')
    await mount()
    await settle()
    expect(exchanged[0]).toContain('"code":"abc"')
    expect(exchanged[0]).toContain('"code_verifier":"the-verifier"')
    expect(window.location.search).toBe('') // the code is not left in the address bar
    expect((host.querySelector('[aria-label="OpenRouter key"]') as HTMLInputElement).value).toBe('sk-or-from-signin')
    expect((host.querySelector('[aria-label="seat 5 model"]') as HTMLInputElement).value).toBe('acme/other')
    expect((host.querySelector('[aria-label="spending cap"]') as HTMLInputElement).value).toBe('2.5')
  })

  it('reports an expired sign-in instead of failing silently', async () => {
    window.history.replaceState(null, '', '/play?code=abc')
    await mount()
    await settle()
    expect(text()).toContain('sign-in expired')
    expect(exchanged).toHaveLength(0)
  })

  it('stops after the hand in progress', async () => {
    await mount(40)
    for (let i = 1; i <= 5; i++) choose(`seat ${i} player`, 'bot')
    await act(async () => button('Deal the first hand')!.click())
    await act(async () => button('Stop after this hand')!.click())
    for (let i = 0; i < 400 && !button('New table'); i++) await act(async () => await new Promise((r) => setTimeout(r, 10)))
    expect(button('New table')).toBeDefined()
    expect(host.querySelectorAll('.hand-head')).toHaveLength(1) // the hand in progress finished, no other began
    expect(text()).toContain('(interrupted)')
  })
})
