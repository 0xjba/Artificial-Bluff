// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    const expected = events.slice(0, shown).map((e) => logLine(e, (id) => id.toUpperCase())).filter((l) => l !== null).length
    expect(host.querySelectorAll('.log li')).toHaveLength(Math.min(expected, 60))
    expect(replayPause(events.find((e) => e.type === 'decision')!)).toBe(1400)
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
  const line = (seq: number, text: string) => ({ seq, kind: 'action' as const, text })
  const render = (lines: ReturnType<typeof line>[]) =>
    act(() => root!.render(<Broadcast channel={{ mode: 'live', title: 'LIVE' }} view={emptyViewForTest()} log={lines} decisionEquity={null} />))

  it('is silent until unmuted, then plays one sound per new line, also after a restart', () => {
    mount(<Broadcast channel={{ mode: 'live', title: 'LIVE' }} view={emptyViewForTest()} log={[]} decisionEquity={null} />)
    render([line(5, 'JEV raise to 300 · 1 ms')])
    expect(played).toEqual([]) // muted by default
    click('Sound off')
    render([line(5, 'JEV raise to 300 · 1 ms'), line(6, 'PILL folds · 2 ms')])
    expect(played).toEqual(['fold'])
    render([]) // a restart or a new programme clears the log
    render([line(1, 'BLOCK call 50 · 1 ms')]) // low event numbers again
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

function emptyViewForTest() {
  return { gameId: null, kind: null, status: 'waiting' as const, seats: [], hand: null, handsPlayed: 0, lastDecision: null, result: null, equity: null, equityEstimated: false, lastSeq: 0 }
}
