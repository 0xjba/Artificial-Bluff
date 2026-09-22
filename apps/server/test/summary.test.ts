import { EventStore } from '@ab/core'
import { describe, expect, it } from 'vitest'
import { handIndex, modelsTable } from '../src/summary'
import { playLiveGame } from './fixtures'

describe('models table', () => {
  it('sums every finished live game: chips, hands won, speed, spend, honesty and style', async () => {
    const store = new EventStore()
    await playLiveGame(store, 'live-a', 8)
    await playLiveGame(store, 'live-b', 6)
    store.setStatus('live-a', 'ended')
    store.setStatus('live-b', 'ended')
    store.createGame('live-running', 'live', {}) // still running: left out
    const table = modelsTable(store)

    expect(table.games).toBe(2)
    expect(table.hands).toBe(14)
    expect(table.seats.map((s) => s.playerId).sort()).toEqual(['block', 'drip', 'jev', 'nimbus', 'pill'])
    const jev = table.seats.find((s) => s.playerId === 'jev')!
    expect(jev).toMatchObject({ model: 'mock/jev', games: 2 })
    expect(jev.hands).toBeGreaterThan(0)
    expect(jev.handsWon).toBeLessThanOrEqual(jev.hands)
    expect(jev.winRate).toBeCloseTo(jev.handsWon / jev.hands, 9)
    expect(jev.decisions).toBeGreaterThan(0)
    expect(jev.costUsd).toBeGreaterThan(0)
    expect(jev.costPerDecisionUsd).toBeCloseTo(jev.costUsd / jev.decisions, 6)
    expect(jev.latencyMeanMs).not.toBeNull()
    expect(jev.style.vpip).not.toBeNull()
    // Chips are conserved across the table, and bb/100 follows the chips won.
    expect(table.seats.reduce((sum, s) => sum + s.chipsWon, 0)).toBe(0)
    expect(table.seats.every((s) => s.honestyGapPts === null || Math.abs(s.honestyGapPts) <= 100)).toBe(true)
    expect(table.seats.some((s) => s.honestyGapPts !== null)).toBe(true) // the mock LLMs state a win chance
    expect(table.seats).toEqual([...table.seats].sort((a, b) => b.chipsWon - a.chipsWon)) // best first
  })

  it('has nothing to show before any game has finished', () => {
    const store = new EventStore()
    expect(modelsTable(store)).toEqual({ games: 0, hands: 0, seats: [] })
  })
})

describe('hand index', () => {
  it('describes every hand of a game from its log, newest first, with true tags', async () => {
    const store = new EventStore()
    await playLiveGame(store, 'live-a', 10)
    store.setStatus('live-a', 'ended')
    const hands = handIndex(store, 'live-a')

    expect(hands).toHaveLength(10)
    expect(hands.map((h) => h.number)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) // newest first
    for (const h of hands) {
      expect(h.pot).toBeGreaterThan(0)
      expect(h.players.length).toBeGreaterThanOrEqual(2)
      expect(h.winners.length).toBeGreaterThanOrEqual(1)
      expect(h.headline.length).toBeGreaterThan(10)
      expect(h.headline).not.toMatch(/undefined|NaN/)
      expect(h.startSeq).toBeGreaterThan(0)
      for (const tag of h.tags) expect(['biggest-pot', 'showdown', 'elimination', 'split', 'timeout', 'jev-vs-llm', 'worst-read']).toContain(tag)
    }
    expect(hands.filter((h) => h.tags.includes('biggest-pot'))).toHaveLength(1)
    expect(hands.find((h) => h.tags.includes('biggest-pot'))!.pot).toBe(Math.max(...hands.map((h) => h.pot)))
    for (const h of hands) expect(h.tags.includes('showdown')).toBe(h.shown.length > 0)
    expect(handIndex(store, 'no-such-game')).toEqual([])
  })
})
