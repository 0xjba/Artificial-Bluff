import { EventStore } from '@ab/core'
import { describe, expect, it } from 'vitest'
import { Director } from '../src/director'
import { Hub, type FeedMessage } from '../src/hub'
import { LiveController } from '../src/live'
import type { ReplayItem } from '../src/replay'
import { mockPlayers, playLiveGame } from './fixtures'

const until = async (check: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

async function setup(queue: () => ReplayItem[], replayPaceMs = 20) {
  const store = new EventStore()
  const hub = new Hub()
  const live = new LiveController({ store, hub, makePlayers: mockPlayers, budgetUsd: 10, paceMs: 1, decisionTimeoutMs: 1000 })
  const director = new Director({ hub, live, queue, replayPaceMs, cooldownMs: 30, emptyWaitMs: 20 })
  const modes: string[] = []
  hub.subscribe((m: FeedMessage) => {
    if (m.type === 'snapshot' && modes.at(-1) !== m.channel.mode) modes.push(m.channel.mode)
  })
  return { store, hub, live, director, modes }
}

describe('Director', () => {
  it('shows replays when idle, cuts to a live game at once, and resumes replays after the cooldown', async () => {
    const events = await playLiveGame(new EventStore(), 'past', 4)
    const { hub, live, director, modes } = await setup(() => [{ title: 'REPLAY · past', gameId: 'past', events }])
    director.start()
    await until(() => hub.current().channel.mode === 'replay' && hub.current().view.handsPlayed >= 1)
    await live.start()
    expect(hub.current().channel.mode).toBe('live')
    await live.idle()
    await until(() => hub.current().channel.mode === 'replay')
    await director.stop()
    expect(modes).toEqual(['idle', 'replay', 'live', 'replay'])
  })

  it('never lets a replay event into a live programme', async () => {
    const events = await playLiveGame(new EventStore(), 'past', 4)
    const { hub, live, director } = await setup(() => [{ title: 'REPLAY · past', gameId: 'past', events }], 5)
    let channel = ''
    const wrong: string[] = []
    hub.subscribe((m) => {
      if (m.type === 'snapshot') channel = m.channel.gameId ?? ''
      if (m.type === 'event' && m.event.gameId !== channel) wrong.push(m.event.gameId)
    })
    director.start()
    await until(() => hub.current().channel.mode === 'replay')
    const { gameId } = await live.start()
    live.stop()
    await live.idle()
    await director.stop()
    expect(gameId).toMatch(/^live-/)
    expect(wrong).toEqual([])
  })

  it('survives a failing replay: logs it, shows the idle screen and tries again', async () => {
    const store = new EventStore()
    const hub = new Hub()
    const live = new LiveController({ store, hub, makePlayers: mockPlayers, budgetUsd: 10, paceMs: 1, decisionTimeoutMs: 1000 })
    const logs: string[] = []
    let calls = 0
    const director = new Director({
      hub, live, replayPaceMs: 5, cooldownMs: 0, emptyWaitMs: 10, log: (l) => logs.push(l),
      queue: () => {
        if (++calls === 1) throw new Error('corrupt log')
        return []
      },
    })
    director.start()
    await until(() => calls >= 3)
    await director.stop()
    expect(logs).toEqual(['director: corrupt log'])
    expect(hub.current().channel.mode).toBe('idle')
  })

  it('shows the idle screen when there is nothing to replay', async () => {
    const { hub, director } = await setup(() => [])
    director.start()
    await new Promise((r) => setTimeout(r, 50))
    expect(hub.current().channel.mode).toBe('idle')
    await director.stop()
  })
})
