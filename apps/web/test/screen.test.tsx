import { buildView, emptyView } from '@ab/core/view'
import { parseServerConfig, startApp, type FeedMessage } from '@ab/server'
import { CallingStation, MockLlm, TagBot } from '@ab/players'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Broadcast } from '../components/Broadcast'
import { seatPosition } from '../components/Table'
import { initialFeed, reduceFeed } from '../lib/feed'
import { mockGame } from './fixtures'

const name = (id: string) => id.toUpperCase()

describe('Broadcast screen', () => {
  it('renders every seat with its character, model badge and mascot, plus the lower third, scoreboard and log', async () => {
    const events = await mockGame(4)
    const cut = events.findIndex((e, i) => i > 30 && e.type === 'decision')
    const view = buildView(events.slice(0, cut + 1))
    const html = renderToStaticMarkup(
      <Broadcast channel={{ mode: 'live', title: 'LIVE' }} view={view} log={[{ seq: 1, kind: 'action', text: 'JEV raise to 300 · 2 ms' }]} decisionEquity={0.3} />,
    )
    for (const who of ['JEV', 'PILL', 'BLOCK', 'DRIP', 'NIMBUS']) expect(html).toContain(`<b>${who}</b>`)
    expect(html).toContain('mock/jev') // the model badge
    expect(html.match(/<svg /g)!.length).toBe(5) // one mascot per seat
    expect(html).toContain('● LIVE')
    expect(html).toContain('said <b>')
    expect(html).toContain('true <b>30%</b>')
    expect(html).toContain('JEV raise to 300')
    expect(html).toContain('Sound off')
    expect(html).not.toMatch(/NaN|undefined/)
  })

  it('shows the waiting card before a game', () => {
    const html = renderToStaticMarkup(<Broadcast channel={null} view={emptyView()} log={[]} decisionEquity={null} />)
    expect(html).toContain('OFF AIR')
    expect(html).toContain('Decisions will appear here.')
  })

  it('places seats around the rim, first at the bottom centre', () => {
    expect(seatPosition(0, 5)).toEqual({ left: 50, top: 99 })
    const tops = [0, 1, 2, 3, 4].map((i) => seatPosition(i, 5).top)
    expect(Math.min(...tops)).toBeLessThan(15) // two seats along the top
  })
})

describe('end to end', () => {
  it('follows a live mock game from the server feed and renders it', async () => {
    const app = await startApp(
      { ...parseServerConfig({}), port: 0, dbPath: ':memory:', mock: true, paceMs: 5, decisionTimeoutMs: 1000, replayPaceMs: 5, cooldownMs: 0, adminToken: null },
      { specs: [], make: () => [new MockLlm('jev', 'mock/jev'), new TagBot('pill'), new MockLlm('block'), new CallingStation('drip'), new MockLlm('nimbus')] },
      () => undefined,
    )
    try {
      const { gameId } = await app.live.start()
      const ac = new AbortController()
      const res = await fetch(`${app.url}/api/feed`, { signal: ac.signal })
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let state = initialFeed()
      let buffer = ''
      let events = 0
      while (events < 40) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let cut: number
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          for (const line of buffer.slice(0, cut).split('\n')) {
            if (!line.startsWith('data: ')) continue
            const m = JSON.parse(line.slice(6)) as FeedMessage
            if (m.type === 'event') events++
            state = reduceFeed(state, m, name)
          }
          buffer = buffer.slice(cut + 2)
        }
      }
      ac.abort()
      expect(state.channel).toMatchObject({ mode: 'live', gameId })
      expect(state.view.seats).toHaveLength(5)
      const html = renderToStaticMarkup(<Broadcast channel={state.channel} view={state.view} log={state.log} decisionEquity={state.decisionEquity} />)
      expect(html).toContain('● LIVE')
      expect(html.match(/<svg /g)!.length).toBe(5)
      expect(state.log.length).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })
})
