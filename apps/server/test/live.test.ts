import { EventStore, type GameEvent } from '@ab/core'
import { describe, expect, it } from 'vitest'
import { Hub } from '../src/hub'
import { LiveBusyError, LiveController } from '../src/live'
import { mockPlayers } from './fixtures'

function controller(over: Partial<ConstructorParameters<typeof LiveController>[0]> = {}) {
  const store = new EventStore()
  const hub = new Hub()
  const live = new LiveController({ store, hub, makePlayers: mockPlayers, budgetUsd: 10, paceMs: 0, decisionTimeoutMs: 1000, ...over })
  return { store, hub, live }
}

describe('LiveController', () => {
  it('runs one live game at a time on the hub, then goes idle', async () => {
    const { store, hub, live } = controller()
    const changes: string[] = []
    live.onChange((state, id) => changes.push(`${state}:${id}`))
    const { gameId } = await live.start()
    expect(gameId).toMatch(/^live-\d{4}-\d{2}-\d{2}T/)
    expect(live.gameId).toBe(gameId)
    expect(hub.current().channel).toMatchObject({ mode: 'live', gameId })
    await expect(live.start()).rejects.toBeInstanceOf(LiveBusyError)
    await live.idle()
    expect(live.gameId).toBeNull()
    expect(changes).toEqual([`live:${gameId}`, `idle:${gameId}`])
    expect(store.game(gameId)!.status).toBe('ended')
    expect(hub.current().view).toMatchObject({ status: 'ended', gameId })
    expect(hub.current().view.lastSeq).toBe(store.events(gameId).at(-1)!.seq)
  })

  it('deals from a random secret seed, never derived from the public game id', async () => {
    const { store, live } = controller()
    const seeds: string[] = []
    for (let i = 0; i < 2; i++) {
      const { gameId } = await live.start()
      await live.idle()
      const seed = (store.game(gameId)!.config as { tournament: { seed: string } }).tournament.seed
      expect(seed).toMatch(/^[0-9a-f]{32}$/)
      expect(seed).not.toContain(gameId)
      seeds.push(seed)
    }
    expect(seeds[0]).not.toBe(seeds[1])
  })

  it('records the line-up metadata and the per-game budget with the game', async () => {
    const { store, live } = controller({ meta: { lineup: [{ id: 'jev', kind: 'mock' }], mock: true }, budgetUsd: 0.75 })
    const { gameId } = await live.start()
    await live.idle()
    expect(store.game(gameId)!.config).toMatchObject({ lineup: [{ id: 'jev', kind: 'mock' }], mock: true, budgetUsd: 0.75 })
  })

  it('stops after the hand in progress when asked', async () => {
    const { store, live } = controller({ paceMs: 5 })
    expect(live.stop()).toBeNull()
    const { gameId } = await live.start()
    await new Promise((r) => setTimeout(r, 50))
    expect(live.stop()).toBe(gameId)
    await live.idle()
    const last = store.events(gameId).at(-1) as Extract<GameEvent, { type: 'game_ended' }>
    expect(last).toMatchObject({ type: 'game_ended', reason: 'interrupted' })
    expect(store.game(gameId)!.status).toBe('interrupted')
  })

  it('waits (without spinning) while slow players are being prepared', async () => {
    const slow = () => new Promise<ReturnType<typeof mockPlayers>>((resolve) => setTimeout(() => resolve(mockPlayers()), 30))
    const { live } = controller({ makePlayers: slow })
    const started = live.start()
    const idle = live.idle()
    let ticked = false
    await new Promise((r) => setTimeout(r, 10)).then(() => (ticked = true)) // would never fire if idle() spun
    expect(ticked).toBe(true)
    await started
    live.stop()
    await idle
    expect(live.gameId).toBeNull()
  })

  it('frees the table if the players cannot be made', async () => {
    let fail = true
    const { live } = controller({
      makePlayers: () => {
        if (fail) throw new Error('OPENROUTER_API_KEY is not set')
        return mockPlayers()
      },
    })
    await expect(live.start()).rejects.toThrow(/OPENROUTER_API_KEY/)
    expect(live.gameId).toBeNull()
    fail = false
    await live.start()
    await live.idle()
  })
})
