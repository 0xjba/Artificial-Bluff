import { buildView, EventStore, runTournamentGame, type GameEvent } from '@ab/core'
import { liveTurboConfig } from '@ab/engine'
import { CallingStation, MockLlm, TagBot } from '@ab/players'
import { describe, expect, it } from 'vitest'
import { Hub, type FeedMessage } from '../src/hub'

async function liveGame(hub: Hub, maxHands = 6): Promise<GameEvent[]> {
  const store = new EventStore()
  const players = [new MockLlm('jev'), new TagBot('pill'), new MockLlm('block'), new CallingStation('drip'), new MockLlm('nimbus')]
  hub.begin({ mode: 'live', title: 'LIVE', gameId: 'g' })
  await runTournamentGame({
    gameId: 'g', players, tournament: { ...liveTurboConfig('hub'), maxHands }, store, decisionTimeoutMs: 1000, budgetUsd: 100,
    onEvent: (e) => hub.publish(e),
  })
  return store.events('g')
}

describe('Hub', () => {
  it('sends a snapshot on subscribe, then every event, and builds the same view as the log', async () => {
    const hub = new Hub()
    const got: FeedMessage[] = []
    hub.subscribe((m) => got.push(m))
    expect(got[0]).toMatchObject({ type: 'snapshot', channel: { mode: 'idle' } })
    const events = await liveGame(hub)
    expect(got[1]).toMatchObject({ type: 'snapshot', channel: { mode: 'live', title: 'LIVE', gameId: 'g' } })
    const sent = got.filter((m): m is Extract<FeedMessage, { type: 'event' }> => m.type === 'event').map((m) => m.event)
    expect(sent).toEqual(events)
    const { view } = hub.current()
    expect({ ...view, equity: null, equityEstimated: false }).toEqual(buildView(events))
    // A late subscriber starts from the same view.
    const late: FeedMessage[] = []
    hub.subscribe((m) => late.push(m))
    expect(late).toEqual([{ type: 'snapshot', channel: hub.current().channel, view }])
  })

  it('annotates true equity whenever the board or the live players change', async () => {
    const hub = new Hub()
    const got: FeedMessage[] = []
    hub.subscribe((m) => got.push(m))
    await liveGame(hub, 3)
    const equity = got.filter((m): m is Extract<FeedMessage, { type: 'equity' }> => m.type === 'equity')
    expect(equity.length).toBeGreaterThan(3)
    for (const m of equity.filter((x) => x.equity)) {
      expect(Object.values(m.equity!).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    }
    // Consecutive annotations differ (no repeats for the same board and players).
    const keys = equity.map((m) => JSON.stringify(m))
    keys.slice(1).forEach((k, i) => expect(k).not.toBe(keys[i]))
  })

  it('drops a subscriber that throws, without disturbing the others', async () => {
    const hub = new Hub()
    const good: FeedMessage[] = []
    hub.subscribe(() => {
      throw new Error('socket closed')
    })
    hub.subscribe((m) => good.push(m))
    expect(hub.clientCount).toBe(1)
    await liveGame(hub, 2)
    expect(good.filter((m) => m.type === 'event').length).toBeGreaterThan(10)
    const unsubscribe = hub.subscribe(() => undefined)
    expect(hub.clientCount).toBe(2)
    unsubscribe()
    expect(hub.clientCount).toBe(1)
  })

  it('starts each programme from an empty view with a new channel id', () => {
    const hub = new Hub()
    const a = hub.begin({ mode: 'replay', title: 'REPLAY', gameId: 'x' })
    const b = hub.idle()
    expect(a.id).not.toBe(b.id)
    expect(hub.current()).toMatchObject({ channel: { mode: 'idle', gameId: null }, view: { status: 'waiting', seats: [] } })
  })
})
