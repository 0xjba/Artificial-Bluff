// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildView, emptyView, type GameEvent } from '@ab/core/view'
import { logLine } from '../lib/log'
import { mockGame } from './fixtures'

const played: string[] = []
vi.mock('../lib/sounds', async (load) => ({
  ...(await load<typeof import('../lib/sounds')>()),
  playSound: (kind: string) => played.push(kind),
  unlockAudio: () => undefined,
}))
const { Broadcast } = await import('../components/Broadcast')
const { ReplayScreen, replayPause } = await import('../components/ReplayScreen')
const { useFeed, RECONNECT_MS } = await import('../components/useFeed')
const { LiveScreen } = await import('../components/LiveScreen')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement
const mount = (el: React.ReactElement) => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(el))
}
const click = (label: string) => {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === label)
  if (!button) throw new Error(`no button ${label}`)
  act(() => button.click())
}
/** Buttons that show an icon are found by their accessible name. */
const clickLabel = (label: string) => {
  const button = host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null
  if (!button) throw new Error(`no button labelled ${label}`)
  act(() => button.click())
}

beforeEach(() => {
  played.length = 0
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('ReplayScreen', () => {
  it('never applies an event twice when paused, resumed or sped up', async () => {
    const events = await mockGame(3)
    vi.useFakeTimers()
    mount(<ReplayScreen title="t" events={events} />)
    for (let i = 0; i < 30; i++) {
      act(() => vi.advanceTimersByTime(3000))
      if (i % 3 === 0) {
        click('Pause')
        click('Play')
      }
      if (i % 5 === 0) click(i % 10 === 0 ? '2x' : '1x')
    }
    const shown = Number(host.querySelector('.progress')!.textContent!.split('/')[0])
    // Hand starts are group headings in the log, not rows.
    const written = events.slice(0, shown).map((e) => logLine(e, (id) => id.toUpperCase(), emptyView())).filter((l) => l !== null)
    const rows = written.slice(-60).filter((l) => l.kind !== 'hand').length
    expect(host.querySelectorAll('.log li')).toHaveLength(rows)
    expect(host.querySelectorAll('.hand-head').length).toBe(written.slice(-60).filter((l) => l.kind === 'hand').length)
    expect(replayPause(events.find((e) => e.type === 'decision')!)).toBe(1400)
  })

  it('shows the true chance beside what the model said (nobody computes equity for a replay)', async () => {
    const events = await mockGame(2)
    vi.useFakeTimers()
    mount(<ReplayScreen title="t" events={events} />)
    for (let i = 0; i < 40; i++) act(() => vi.advanceTimersByTime(3000))
    const claims = [...host.querySelectorAll('.claims > div')].map((d) => d.querySelector('b')!.textContent)
    expect(claims[0]).toMatch(/^\d+%$/) // AI SAID
    expect(claims[2]).toMatch(/^\d+%$/) // REALITY: worked out by the screen itself
  })

  it('shows Ended when the replay is over', async () => {
    const events = (await mockGame(1)).slice(0, 5)
    vi.useFakeTimers()
    mount(<ReplayScreen title="t" events={events} />)
    for (let i = 0; i < 10; i++) act(() => vi.advanceTimersByTime(5000)) // one step per act (React applies updates at its end)
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Ended' && b.disabled)).toBe(true)
  })
})

describe('Broadcast sounds', () => {
  const line = (seq: number, text: string) => ({ seq, ts: Date.UTC(2026, 8, 22, 12, 0) + seq * 1000, kind: 'action' as const, tag: 'CALL', text })
  const render = (lines: ReturnType<typeof line>[]) =>
    act(() => root!.render(<Broadcast channel={{ mode: 'live', title: 'LIVE' }} view={emptyViewForTest()} log={lines} decisionEquity={null} />))

  it('is silent until unmuted, then plays one sound per appended line, also after a restart; rebuilt logs are silent', () => {
    mount(<Broadcast channel={{ mode: 'live', title: 'LIVE' }} view={emptyViewForTest()} log={[]} decisionEquity={null} />)
    const a = line(5, 'HEX raises to 300')
    render([a])
    expect(played).toEqual([]) // muted by default
    clickLabel('turn sound on')
    const b = line(6, 'PILL folds')
    render([a, b])
    expect(played).toEqual(['fold'])
    render([line(1, 'Hand 1'), line(2, 'DRIP folds'), line(3, 'HEX raises to 300')]) // seeking or joining rebuilds the log at once
    expect(played).toEqual(['fold'])
    render([]) // a restart or a new programme clears the log
    render([line(1, 'BLOCK calls 50')]) // low event numbers again
    expect(played).toEqual(['fold', 'chip'])
  })
})

describe('useFeed', () => {
  it('opens a new connection when the browser gives up on the feed', () => {
    const sources: FakeSource[] = []
    class FakeSource {
      static readonly CLOSED = 2
      readyState = 0
      onopen: (() => void) | null = null
      onerror: (() => void) | null = null
      onmessage: ((m: { data: string }) => void) | null = null
      constructor(readonly url: string) {
        sources.push(this)
      }
      close() {
        this.readyState = 2
      }
    }
    vi.stubGlobal('EventSource', FakeSource)
    vi.useFakeTimers()
    let seen = ''
    function Probe() {
      seen = useFeed('/api/feed').connection
      return null
    }
    mount(<Probe />)
    expect(seen).toBe('connecting')
    act(() => sources[0]!.onopen!())
    expect(seen).toBe('open')
    act(() => {
      sources[0]!.readyState = 2 // an error status: the browser won't retry
      sources[0]!.onerror!()
    })
    expect(seen).toBe('lost')
    act(() => vi.advanceTimersByTime(RECONNECT_MS[0]!))
    expect(sources).toHaveLength(2)
    act(() => sources[1]!.onmessage!({ data: JSON.stringify({ type: 'snapshot', channel: { id: 'c', mode: 'idle', title: 'x', gameId: null }, view: emptyViewForTest() }) }))
  })
})

describe('LiveScreen time shift', () => {
  it('seeks back and returns live; a reconnect or a new programme drops the past at once and reloads the history', async () => {
    const events = await mockGame(3)
    const sources: Array<{ onmessage: ((m: { data: string }) => void) | null }> = []
    vi.stubGlobal(
      'EventSource',
      class {
        static readonly CLOSED = 2
        readyState = 1
        onopen = null
        onerror = null
        onmessage: ((m: { data: string }) => void) | null = null
        constructor() {
          sources.push(this)
        }
        close() {}
      },
    )
    const fetched: string[] = []
    let backlog: GameEvent[] = events.slice(0, 40)
    vi.stubGlobal('fetch', async (url: URL | string) => {
      fetched.push(String(url))
      const page = backlog
      return { ok: true, json: async () => ({ events: page, next: null }) }
    })
    const settle = () => act(async () => await new Promise((r) => setTimeout(r, 0)))
    const send = (m: unknown) => act(() => sources[0]!.onmessage!({ data: JSON.stringify(m) }))
    const tag = () => host.querySelector('.programme .tag') as HTMLButtonElement
    const back = () => act(() => (host.querySelector('button[aria-label="previous hand"]') as HTMLButtonElement).click())
    const channel = { id: 'c1', mode: 'live', title: 'LIVE', gameId: 'g' }

    mount(<LiveScreen feedUrl="/api/feed" />)
    send({ type: 'snapshot', channel, view: buildView(events.slice(0, 40)) })
    await settle()
    for (const e of events.slice(40, 80)) send({ type: 'event', channelId: 'c1', event: e })
    expect(fetched[0]).toMatch(/\/api\/games\/g\/events\?after=0$/)
    expect(host.querySelector('.seek')).not.toBeNull()
    expect(host.querySelectorAll('.hand-head').length).toBeGreaterThan(0) // the log covers the game from its start

    back()
    expect(tag().className).toContain('behind')
    act(() => tag().click())
    expect(tag().className).not.toContain('behind')

    // A reconnect (same channel, new snapshot): back to live at once, the history is fetched again.
    back()
    expect(tag().className).toContain('behind')
    backlog = events.slice(0, 80)
    send({ type: 'snapshot', channel, view: buildView(events.slice(0, 80)) })
    expect(tag().className).not.toContain('behind')
    await settle()
    expect(fetched).toHaveLength(2)
    expect(host.querySelector('.seek')).not.toBeNull()

    // A new programme: the old game's past is never drawn, not even for one render.
    back()
    expect(tag().className).toContain('behind')
    send({ type: 'snapshot', channel: { ...channel, id: 'c2' }, view: buildView(events.slice(0, 5)) })
    expect(tag().className).not.toContain('behind')
    expect(played).toEqual([]) // muted by default, and nothing to hear from rebuilt logs anyway
  })
})

function emptyViewForTest() {
  return { gameId: null, kind: null, status: 'waiting' as const, seats: [], hand: null, handsPlayed: 0, lastDecision: null, result: null, equity: null, equityEstimated: false, lastSeq: 0 }
}
