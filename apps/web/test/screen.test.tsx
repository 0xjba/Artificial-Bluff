import { applyEvent, buildView, emptyView, withEquity } from '@ab/core/view'
import { parseServerConfig, startApp, type FeedMessage } from '@ab/server'
import { CallingStation, MockLlm, TagBot } from '@ab/players'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Broadcast, programmeStatus } from '../components/Broadcast'
import { handGroups } from '../components/HandLog'
import { PIPS, PlayingCard } from '../components/PlayingCard'
import { isCurrent } from '../components/SiteNav'
import { phonePlace, seatPlace } from '../components/Stage'
import type { LogLine } from '../lib/log'
import { initialFeed, reduceFeed } from '../lib/feed'
import { logLine } from '../lib/log'
import { mockGame } from './fixtures'

const name = (id: string) => id.toUpperCase()

describe('Broadcast screen', () => {
  it('renders every seat with its character, mascot, the players panel, the last decision and the log', async () => {
    const events = await mockGame(4)
    const cut = events.findIndex((e, i) => i > 30 && e.type === 'decision')
    const view = buildView(events.slice(0, cut + 1))
    const html = renderToStaticMarkup(
      <Broadcast channel={{ mode: 'live', title: 'LIVE' }} view={view} log={[{ seq: 1, ts: Date.UTC(2026, 8, 22, 12, 4), kind: 'action', tag: 'RAISE', text: 'JEV raises to 300' }]} decisionEquity={0.3} />,
    )
    for (const who of ['JEV', 'PILL', 'BLOCK', 'DRIP', 'NIMBUS']) expect(html).toContain(`<b>${who}</b>`)
    expect(html).toContain('mock/jev') // the model, in the players panel
    // A mascot per seat on the felt, named with what it is doing; the panel's are decorative.
    expect(html.match(/aria-label="[A-Z]+, [a-z ]+"/g)!.length).toBe(view.seats.length)
    expect(html.match(/class="player[ "]/g)!.length).toBe(view.seats.length) // one panel row per seat
    expect(html).toContain('LIVE')
    expect(html).toContain('AI SAID')
    expect(html).toContain('>30%</b>') // the true chance, against what the model said
    expect(html).toContain('JEV raises to 300')
    expect(html).toContain('RAISE')
    expect(html).toContain('turn sound on') // the sound toggle sits beside the LIVE tag
    expect(html).toContain('WHO IS PLAYING')
    expect(html).not.toMatch(/NaN|undefined/)
  })

  it('shows the waiting card before a game', () => {
    const html = renderToStaticMarkup(<Broadcast channel={null} view={emptyView()} log={[]} decisionEquity={null} />)
    expect(html).toContain('OFF AIR')
    expect(html).toContain('Decisions will appear here.')
  })

  it('places seats around the portrait felt, the first at the bottom', () => {
    expect(seatPlace(0, 5)).toEqual({ left: 50, top: 95 })
    for (const n of [2, 3, 4, 5]) {
      const places = Array.from({ length: n }, (_, i) => seatPlace(i, n))
      expect(places[0]).toEqual({ left: 50, top: 95 })
      expect(new Set(places.map((p) => `${p.left},${p.top}`)).size).toBe(n) // no two seats in one place
      expect(Math.min(...places.map((p) => p.top))).toBeLessThan(25) // someone across the table
    }
    expect(seatPlace(1, 7).top).toBeGreaterThan(0) // more seats than places: round the ellipse
  })

  it('gives a phone its own places: out to the edges, and far enough apart for the pills not to touch', () => {
    // A phone's felt is 280 x 660 with pills 118 x 150; the places are in percent of that box.
    const W = 280
    const H = 660
    const PILL = { w: 118, h: 150 }
    for (const n of [2, 3, 4, 5]) {
      const boxes = Array.from({ length: n }, (_, i) => {
        const p = phonePlace(i, n)
        return { x: (p.left / 100) * W - PILL.w / 2, y: (p.top / 100) * H - PILL.h / 2 }
      })
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const a = boxes[i]!
          const b = boxes[j]!
          const apart = Math.min(a.x + PILL.w, b.x + PILL.w) - Math.max(a.x, b.x) <= 0 || Math.min(a.y + PILL.h, b.y + PILL.h) - Math.max(a.y, b.y) <= 0
          expect(apart, `seats ${i} and ${j} of ${n} overlap`).toBe(true)
        }
      // The seats that aren't on the centre line sit out at the rim, using the width either side of
      // the felt rather than huddling in the middle of a narrow screen.
      const outer = boxes.filter((b) => Math.abs(b.x + PILL.w / 2 - W / 2) > W * 0.35)
      if (n > 2) expect(outer.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('underlines the section being viewed', () => {
    expect([isCurrent('/', '/'), isCurrent('/', '/replays'), isCurrent('/replays', '/replays/live-1'), isCurrent('/play', '/replays')]).toEqual([true, false, true, false])
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
      expect(html).toContain('LIVE')
      expect(html.match(/aria-label="[A-Z]+, [a-z ]+"/g)!.length).toBe(state.view.seats.length)
      expect(state.log.length).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })
})

describe('screen pieces', () => {
  it('draws cards like real ones: corner indices, pips, aces and court cards', () => {
    const pips = (html: string) => (html.match(/class="pip"/g) ?? []).length
    const seven = renderToStaticMarkup(<PlayingCard code="7h" />)
    expect(seven).toContain('aria-label="7 of hearts"')
    expect(seven).toContain('card face red')
    expect(pips(seven)).toBe(7)
    expect((seven.match(/class="corner"/g) ?? []).length).toBe(2)
    expect(seven).toContain('rotate(180 50 70)') // the bottom-right corner, upside down
    expect(pips(renderToStaticMarkup(<PlayingCard code="Tc" />))).toBe(10)
    expect(pips(renderToStaticMarkup(<PlayingCard code="As" />))).toBe(1)
    const king = renderToStaticMarkup(<PlayingCard code="Kd" />)
    expect(king).toContain('court-frame')
    expect(king).toContain('aria-label="king of diamonds"')
    const seatCard = renderToStaticMarkup(<PlayingCard code="9s" small />)
    expect(pips(seatCard)).toBe(1) // seat cards: rank in the corner, one big suit in the middle
    expect(seatCard).toMatch(/fontSize="80"|font-size="80"/)
    expect(renderToStaticMarkup(<PlayingCard code={null} />)).toContain('face-down card')
    for (const [rank, spots] of Object.entries(PIPS)) expect(spots).toHaveLength(Number(rank))
  })

  it('never repeats the tag in the title', async () => {
    const events = await mockGame(2)
    const cut = events.findIndex((e) => e.type === 'decision')
    expect(programmeStatus({ mode: 'live', title: 'LIVE' }, buildView(events.slice(0, cut + 1)))).toEqual(['HAND 1', 'BLINDS 25/50'])
    expect(programmeStatus({ mode: 'live', title: 'LIVE' }, emptyView())).toEqual([])
    expect(programmeStatus({ mode: 'replay', title: 'REPLAY · live game live-1' }, emptyView())).toEqual(['live game live-1'])
    expect(programmeStatus(null, emptyView())).toEqual(['CONNECTING…'])
  })

  it('makes the LIVE tag a button that is dimmed while watching the past', () => {
    const html = (behind: boolean) =>
      renderToStaticMarkup(<Broadcast channel={{ mode: 'live', title: 'LIVE' }} view={emptyView()} log={[]} decisionEquity={null} live={{ behind, onGoLive: () => undefined }} />)
    expect(html(false)).toMatch(/<button[^>]*class="tag live"/)
    expect(html(true)).toContain('class="tag live behind"')
    expect(html(true)).toContain('Back to live')
  })

  it('groups the log by hand: newest hand first, its own lines newest first, with a summary', async () => {
    const events = await mockGame(3)
    let view = emptyView()
    const lines = events
      .map((e) => {
        const line = logLine(e, name, view)
        view = applyEvent(view, e)
        return line
      })
      .filter((l) => l !== null)
    const groups = handGroups(lines, view)
    expect(groups).toHaveLength(3)
    expect(groups.map((g) => g.title)).toEqual(['Hand 3', 'Hand 2', 'Hand 1'])
    expect(groups[0]!.lines[0]!.seq).toBeGreaterThan(groups[0]!.lines.at(-1)!.seq) // newest first inside a hand
    expect(groups.at(-1)!.meta).toMatch(/^[A-Z &]+ won [\d,]+$/) // who won it, and nothing else
    const open = handGroups(lines.slice(0, -4), { ...view, hand: { ...view.hand!, ended: false, pot: 900, street: 'flop' } })
    expect(open[0]!.meta).toBe('in progress · pot 900 · flop')
  })

  it('groups a log that starts mid-hand under "Earlier"', async () => {
    const events = await mockGame(2)
    let view = emptyView()
    const lines = events
      .map((e) => {
        const line = logLine(e, name, view)
        view = applyEvent(view, e)
        return line
      })
      .filter((l) => l !== null)
    const firstHand = lines.findIndex((l) => l.kind === 'hand')
    const secondHand = lines.findIndex((l, i) => i > firstHand && l.kind === 'hand')
    const groups = handGroups(lines.slice(firstHand + 2), view) // joined after the first hand began
    expect(groups.at(-1)!.title).toBe('Earlier')
    expect(groups.at(-1)!.lines.length).toBeGreaterThan(0)
    expect(groups.map((g) => g.title).filter((t) => t.startsWith('Hand'))).toHaveLength(1)
    expect(secondHand).toBeGreaterThan(firstHand)
  })

  it('shows each seat\'s win chance, in the panel and on the seat', async () => {
    const events = await mockGame(2)
    const cut = events.findIndex((e) => e.type === 'decision')
    const view = withEquity(buildView(events.slice(0, cut + 1)), { jev: 0.36, pill: 0.64 }, true)
    const html = renderToStaticMarkup(<Broadcast channel={{ mode: 'live', title: 'LIVE' }} view={view} log={[]} decisionEquity={null} />)
    expect(html.match(/Win chances/g)!.length).toBe(view.seats.length * 2) // once per seat, once per panel row
    // The ≈ of an estimate is its own mark, so it can be set lighter than the number it qualifies.
    expect(html).toContain('<i class="approx">≈</i>36%')
    expect(html).toContain('Chance this player wins the hand')
  })
})
