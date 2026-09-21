import { liveTurboConfig } from '@ab/engine'
import { CallingStation, MockLlm, TagBot, type Player } from '@ab/players'
import { describe, expect, it } from 'vitest'
import type { GameEvent } from '../src/events'
import { runTournamentGame } from '../src/game'
import { EventStore } from '../src/store'

const lineup = (): Player[] => [new MockLlm('jev'), new TagBot('pill'), new MockLlm('block'), new CallingStation('drip'), new MockLlm('nimbus')]
const ended = (events: GameEvent[]) => events.at(-1) as Extract<GameEvent, { type: 'game_ended' }>

describe('runTournamentGame', () => {
  it('plays a full live tournament into the store, conserving chips', async () => {
    const store = new EventStore()
    const t = await runTournamentGame({ gameId: 'g1', players: lineup(), tournament: liveTurboConfig('seed-1'), store, decisionTimeoutMs: 1000, budgetUsd: 100 })
    expect(t.complete).toBe(true)
    const events = store.events('g1')
    expect(events[0]).toMatchObject({ type: 'game_started', configHash: store.game('g1')!.configHash })
    expect(ended(events)).toMatchObject({ type: 'game_ended', winner: t.winner, handsPlayed: t.handNumber })
    expect(Object.values(ended(events).stacks).reduce((a, b) => a + b, 0)).toBe(15_000)
    expect(store.game('g1')!.status).toBe('ended')
    expect(events.filter((e) => e.type === 'hand_started')).toHaveLength(t.handNumber)
    // Hand ids run hand-0, hand-1, ... in order.
    const ids = events.filter((e) => e.type === 'hand_ended').map((e) => (e as { handId: string }).handId)
    expect(ids).toEqual(ids.map((_, i) => `hand-${i}`))
  })

  it('is reproducible: same seed and deterministic players give identical event streams', async () => {
    const run = async () => {
      const store = new EventStore()
      await runTournamentGame({ gameId: 'g', players: lineup(), tournament: liveTurboConfig('same'), store, decisionTimeoutMs: 1000, budgetUsd: 100, now: () => 0 })
      return store.events('g').map(({ ts: _ts, ...e }) => e)
    }
    expect(await run()).toEqual(await run())
  })

  it('stops spending at the budget cap within one decision, then ends the game', async () => {
    const store = new EventStore()
    const pricey = lineup().map((p) => new MockLlm(p.id, 'mock/pricey', { inputPricePerMTok: 50_000 }))
    const t = await runTournamentGame({ gameId: 'g2', players: pricey, tournament: liveTurboConfig('s'), store, decisionTimeoutMs: 1000, budgetUsd: 0.5 })
    expect(t.endReason).toBe('budget_cap')
    const paid = store.events('g2').filter((e): e is Extract<GameEvent, { type: 'decision' }> => e.type === 'decision' && e.costUsd > 0)
    const maxOne = Math.max(...paid.map((d) => d.costUsd))
    const cost = store.gameCost('g2')
    expect(cost).toBeGreaterThanOrEqual(0.5)
    expect(cost).toBeLessThan(0.5 + maxOne) // overspend is at most one decision
    expect(ended(store.events('g2')).reason).toBe('budget_cap')
  })

  it('streams every stored event to onEvent, and a failing listener never stops the game', async () => {
    const store = new EventStore()
    const seen: GameEvent[] = []
    const errors: unknown[] = []
    await runTournamentGame({
      gameId: 'g8', players: lineup(), tournament: { ...liveTurboConfig('s'), maxHands: 3 }, store, decisionTimeoutMs: 1000, budgetUsd: 1,
      onEvent: (e) => {
        seen.push(e)
        if (e.type === 'turn_started') throw new Error('listener bug')
      },
      onListenerError: (e) => errors.push(e),
    })
    expect(seen).toEqual(store.events('g8'))
    expect(errors.length).toBeGreaterThan(0)
    expect(store.game('g8')!.status).toBe('ended')
  })

  it('stops as interrupted when the signal aborts', async () => {
    const store = new EventStore()
    const ac = new AbortController()
    ac.abort()
    const t = await runTournamentGame({ gameId: 'g3', players: lineup(), tournament: liveTurboConfig('s'), store, decisionTimeoutMs: 1000, budgetUsd: 100, signal: ac.signal })
    expect(t.endReason).toBe('interrupted')
    expect(store.game('g3')!.status).toBe('interrupted')
  })

  it('records the line-up and settings in the pre-registered game config', async () => {
    const store = new EventStore()
    await runTournamentGame({ gameId: 'g4', players: lineup(), tournament: { ...liveTurboConfig('s'), maxHands: 2 }, store, decisionTimeoutMs: 1000, budgetUsd: 1, meta: { note: 'test' } })
    const game = store.game('g4')!
    expect(game.config).toMatchObject({ budgetUsd: 1, decisionTimeoutMs: 1000, note: 'test', players: [{ id: 'jev', kind: 'mock', model: 'mock/llm' }, { id: 'pill' }, { id: 'block' }, { id: 'drip' }, { id: 'nimbus' }] })
    expect(game.configHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ends the game as interrupted if anything throws mid-game, then rethrows', async () => {
    const store = new EventStore()
    const run = runTournamentGame({
      gameId: 'g5', players: lineup(), tournament: liveTurboConfig('s'), store, decisionTimeoutMs: 1000, budgetUsd: 100,
      paceMs: 1,
      sleep: async () => {
        throw new Error('boom')
      },
    })
    await expect(run).rejects.toThrow('boom')
    expect(store.game('g5')!.status).toBe('interrupted')
    expect(ended(store.events('g5'))).toMatchObject({ type: 'game_ended', reason: 'interrupted' })
  })

  it('writes nothing for an invalid tournament', async () => {
    const store = new EventStore()
    const dupes = [new MockLlm('a'), new MockLlm('a')]
    await expect(runTournamentGame({ gameId: 'g6', players: dupes, tournament: liveTurboConfig('s'), store, decisionTimeoutMs: 1000, budgetUsd: 1 })).rejects.toThrow(/unique/)
    expect(store.game('g6')).toBeNull()
  })

  it('does not let meta override the settings the game runs with', async () => {
    const store = new EventStore()
    await runTournamentGame({
      gameId: 'g7', players: lineup(), tournament: { ...liveTurboConfig('s'), maxHands: 1 }, store, decisionTimeoutMs: 1000, budgetUsd: 1,
      meta: { budgetUsd: 999, decisionTimeoutMs: 1, note: 'kept' },
    })
    expect(store.game('g7')!.config).toMatchObject({ budgetUsd: 1, decisionTimeoutMs: 1000, note: 'kept' })
  })
})
