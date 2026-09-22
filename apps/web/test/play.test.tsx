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

beforeEach(async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url) === 'https://openrouter.ai/api/v1/models') return { ok: true, json: async () => ({ data: catalog }) }
    throw new Error(`unexpected call to ${url}`)
  })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<PlayScreen paceMs={0} />))
  await settle()
})
afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

describe('/play', () => {
  it('starts with Jev and four models, and says what is missing', () => {
    expect(text()).toContain('JEV')
    expect((host.querySelector('[aria-label="seat 2 model"]') as HTMLInputElement).value).toBe('anthropic/claude-sonnet-5')
    expect(text()).toContain('connect OpenRouter (or paste a key) for the model seats')
    expect(text()).toContain('add a TypeSafe key for the Jev seat')
    expect(text()).toContain('Relayed:') // the Jev relay is explained next to the TypeSafe key
    expect(button('Start the game')!.disabled).toBe(true)
    choose('OpenRouter key', 'sk-or-test')
    choose('TypeSafe key', 'ts-test')
    expect(button('Start the game')!.disabled).toBe(false)
    expect(host.querySelectorAll('#play-models option')).toHaveLength(5)
  })

  it('runs a free all-bot table on the broadcast screen, keeping no keys', async () => {
    for (let i = 1; i <= 5; i++) choose(`seat ${i} player`, 'bot')
    expect(text()).toContain('PEBBLE') // seat 1 without Jev
    expect(text()).not.toContain('Relayed:')
    expect(text()).toContain('≈ $0 for a whole game')
    await act(async () => button('Start the game')!.click())
    for (let i = 0; i < 50 && !button('New table'); i++) await settle()
    expect(host.querySelector('.broadcast')).not.toBeNull()
    expect(host.querySelectorAll('.log li').length).toBeGreaterThan(0)
    expect(button('New table')).toBeDefined()
    expect(text()).toContain('spent $0 of $1')
    expect(localStorage.length).toBe(0)
    act(() => button('New table')!.click())
    expect(text()).toContain('Run your own table')
  })
})
