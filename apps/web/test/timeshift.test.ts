import { buildView } from '@ab/core/view'
import { describe, expect, it } from 'vitest'
import { cachedTableEquity } from '../lib/equity'
import { initialFeed, reduceFeed } from '../lib/feed'
import { feedAt, handAt, handStarts, mergeHistory, nextHand, prevHand } from '../lib/timeshift'
import { mockGame } from './fixtures'

const name = (id: string) => id.toUpperCase()
const channel = { id: 'c1', mode: 'live' as const, title: 'LIVE', gameId: 'g' }

describe('time shift', () => {
  it('merges a fetched backlog with events the feed brought, each once and in order', async () => {
    const events = await mockGame(2)
    const merged = mergeHistory(events.slice(0, 30), events.slice(20, 50))
    expect(merged.map((e) => e.seq)).toEqual(events.slice(0, 50).map((e) => e.seq))
  })

  it('keeps the programme history in the feed state: feed events append, a backlog merges in, a snapshot clears it', async () => {
    const events = await mockGame(2)
    // Joined mid-game: the snapshot is the table after 40 events, then the feed brings the rest.
    let state = reduceFeed(initialFeed(), { type: 'snapshot', channel, view: buildView(events.slice(0, 40)) }, name)
    for (const e of events.slice(40)) state = reduceFeed(state, { type: 'event', channelId: 'c1', event: e }, name)
    expect(state.history).toHaveLength(events.length - 40)
    state = reduceFeed(state, { type: 'history', channelId: 'c1', events: events.slice(0, 45) }, name)
    expect(state.history.map((e) => e.seq)).toEqual(events.map((e) => e.seq))
    expect(state.log).toEqual(feedAt(channel, events, events.length, name).log) // the log now covers the whole game
    expect(reduceFeed(state, { type: 'history', channelId: 'old', events: [] }, name)).toBe(state)
    expect(reduceFeed(state, { type: 'snapshot', channel: { ...channel, id: 'c2' }, view: buildView([]) }, name).history).toEqual([])
  })

  it('keeps the true chance with the decision on screen: a new hand does not blank it', async () => {
    const events = await mockGame(2)
    let state = reduceFeed(initialFeed(), { type: 'snapshot', channel, view: buildView([]) }, name)
    let blanked = 0
    for (const e of events) {
      state = reduceFeed(state, { type: 'event', channelId: 'c1', event: e }, name, cachedTableEquity)
      // The panel shows a decision until the next one replaces it, across the gap between hands.
      if (state.view.lastDecision && state.decisionEquity === null) blanked++
    }
    expect(blanked).toBe(0)
  })

  it('rebuilds the screen at any point of the history', async () => {
    const events = await mockGame(3)
    const at = feedAt(channel, events, 60, name)
    expect(at.view).toEqual({ ...buildView(events.slice(0, 60)), equity: null, equityEstimated: false })
    expect(at.log.length).toBeGreaterThan(0)
    expect(at.log.at(-1)!.seq).toBeLessThanOrEqual(events[59]!.seq)
    expect(at.channel).toEqual(channel)
  })

  it('works out the true chances of the past too, and only once per board', async () => {
    const events = await mockGame(3)
    const decision = events.findIndex((e, i) => i > 30 && e.type === 'decision')
    const at = feedAt(channel, events, decision + 1, name, cachedTableEquity)
    expect(at.decisionEquity).toBeGreaterThan(0) // REALITY, against what that seat said
    expect(Object.keys(at.view.equity ?? {}).length).toBeGreaterThan(1) // and a win chance per live seat
    // Dragging rebuilds the screen over and over: the second pass must be cached, not recomputed.
    const once = Date.now()
    feedAt(channel, events, decision + 1, name, cachedTableEquity)
    expect(Date.now() - once).toBeLessThan(60)
  })

  it('steps between hands', async () => {
    const events = await mockGame(3)
    const starts = handStarts(events)
    expect(starts).toHaveLength(3)
    expect(events[starts[1]! - 1]!.type).toBe('hand_started')
    const decisionsIn2 = events.map((e, i) => (i >= starts[1]! && e.type === 'decision' ? i + 1 : 0)).filter((p) => p > 0)
    expect(prevHand(events, decisionsIn2[1]!)).toBe(starts[1]) // two decisions in: back to this hand's start
    expect(prevHand(events, decisionsIn2[0]!)).toBe(starts[0]) // barely begun: the hand before
    expect(prevHand(events, starts[1]!)).toBe(starts[0])
    expect(prevHand(events, starts[1]! + 1)).toBe(starts[0])
    expect(prevHand(events, 0)).toBe(starts[0])
    expect(nextHand(events, starts[0]!)).toBe(starts[1])
    expect(nextHand(events, starts[2]!)).toBeNull()
    expect(handAt(events, starts[1]! + 3)).toBe(2)
    expect(handAt(events, 0)).toBe(0)
  })
})
