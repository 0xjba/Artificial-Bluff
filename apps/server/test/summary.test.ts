import { EventStore } from '@ab/core'
import { describe, expect, it } from 'vitest'
import type { HandRecord } from '@ab/analysis'
import { handIndex, modelsTable, SUMMARY_CACHE_GAMES, type SummaryCache } from '../src/summary'
import { extractHands } from '@ab/analysis'
import { CallingStation, MockLlm, TagBot } from '@ab/players'
import { playLiveGame } from './fixtures'

const extractHandsOf = (store: EventStore, gameId: string) => extractHands(store.events(gameId))

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
    expect(table.seats.map((s) => s.playerId).sort()).toEqual(['block', 'drip', 'hex', 'nimbus', 'pill'])
    const jev = table.seats.find((s) => s.playerId === 'hex')!
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
    expect(table.seats.every((s) => s.biasPts === null || Math.abs(s.biasPts) <= 100)).toBe(true)
    expect(table.seats.every((s) => s.errorPts === null || (s.errorPts >= 0 && s.errorPts <= 100))).toBe(true)
    // The error never cancels, so it is at least as large as the bias it comes from.
    expect(table.seats.every((s) => s.errorPts === null || s.errorPts >= Math.abs(s.biasPts!) - 1e-9)).toBe(true)
    expect(table.seats.some((s) => s.errorPts !== null)).toBe(true) // the mock LLMs state a win chance
    expect(jev.models).toEqual(['mock/jev'])
    expect(table.seats).toEqual([...table.seats].sort((a, b) => b.chipsWon - a.chipsWon)) // best first
  })

  it('also counts by model, wherever each one sat: the seats are the house, the models move', async () => {
    const store = new EventStore()
    // The same two models, in swapped seats from one game to the next; the bots stay put.
    await playLiveGame(store, 'live-a', 8, [new MockLlm('hex', 'mock/alpha'), new TagBot('pill'), new MockLlm('block', 'mock/beta'), new CallingStation('drip'), new MockLlm('nimbus', 'mock/gamma')])
    await playLiveGame(store, 'live-b', 6, [new MockLlm('hex', 'mock/beta'), new TagBot('pill'), new MockLlm('block', 'mock/alpha'), new CallingStation('drip'), new MockLlm('nimbus', 'mock/gamma')])
    store.setStatus('live-a', 'ended')
    store.setStatus('live-b', 'ended')
    const table = modelsTable(store)
    const byModel = new Map(table.models.map((m) => [m.model, m]))
    expect([...byModel.keys()].sort()).toEqual(['bot/calling-station', 'bot/tag', 'mock/alpha', 'mock/beta', 'mock/gamma'])

    // alpha played HEX in the first game and BLOCK in the second: one row, both games, both seats
    // (newest game first).
    const alpha = byModel.get('mock/alpha')!
    expect(alpha).toMatchObject({ games: 2, seats: ['block', 'hex'] })
    const seatHands = (gameId: string, seat: string) => extractHandsOf(store, gameId).filter((h) => h.seats.some((s) => s.playerId === seat)).length
    expect(alpha.hands).toBe(seatHands('live-a', 'hex') + seatHands('live-b', 'block'))
    expect(alpha.costPerDecisionUsd).toBeCloseTo(alpha.costUsd / alpha.decisions, 6)
    expect(alpha.errorPts).not.toBeNull()

    // Every seat in every game is exactly one model, so chips are still conserved across the rows.
    expect(table.models.reduce((sum, m) => sum + m.chipsWon, 0)).toBe(0)
    expect(table.models.reduce((sum, m) => sum + m.hands, 0)).toBe(table.seats.reduce((sum, s) => sum + s.hands, 0))
    // Ranked by chips per hundred hands, which stays comparable when models have played unequal numbers of hands.
    const ranked = table.models.filter((m) => m.bb100 !== null).map((m) => m.bb100!)
    expect(ranked).toEqual([...ranked].sort((a, b) => b - a))
  })

  it('keeps only the newest games in its cache', async () => {
    const store = new EventStore()
    const cache: SummaryCache = new Map()
    for (let i = 0; i < SUMMARY_CACHE_GAMES + 2; i++) {
      await playLiveGame(store, `live-${i}`, 1)
      handIndex(store, `live-${i}`, cache)
    }
    expect(cache.size).toBe(SUMMARY_CACHE_GAMES)
    expect(cache.has('live-0')).toBe(false)
    expect(cache.has(`live-${SUMMARY_CACHE_GAMES + 1}`)).toBe(true)
  })

  it('has nothing to show before any game has finished', () => {
    const store = new EventStore()
    expect(modelsTable(store)).toEqual({ games: 0, hands: 0, seats: [], models: [] })
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

  it('reports the chips actually awarded, and splits them between winners', async () => {
    const store = new EventStore()
    const events = await playLiveGame(store, 'live-a', 12)
    store.setStatus('live-a', 'ended')
    const awarded = new Map<string, { total: number; won: Record<string, number> }>()
    for (const e of events) {
      if (e.type !== 'pot_awarded' || e.handId === null) continue
      const pot = awarded.get(e.handId) ?? { total: 0, won: {} }
      pot.total += e.amount
      for (const [w, share] of Object.entries(e.shares)) pot.won[w] = (pot.won[w] ?? 0) + share
      awarded.set(e.handId, pot)
    }
    for (const h of handIndex(store, 'live-a')) {
      expect(h.pot).toBe(awarded.get(h.handId)!.total) // the pot, not the winners' profit
      expect(h.won).toEqual(awarded.get(h.handId)!.won)
      expect(Object.values(h.won).reduce((a, b) => a + b, 0)).toBeCloseTo(h.pot, 9)
      if (h.winners.length > 1) expect(h.headline).toMatch(/split [\d,]+ between them$/)
    }
  })

  it('only one hand is the biggest pot, even when two tie', async () => {
    const store = new EventStore()
    await playLiveGame(store, 'live-a', 12)
    store.setStatus('live-a', 'ended')
    const hands = handIndex(store, 'live-a')
    const biggest = hands.filter((h) => h.tags.includes('biggest-pot'))
    expect(biggest).toHaveLength(1)
    expect(biggest[0]!.pot).toBe(Math.max(...hands.map((h) => h.pot)))
  })

  it('can list a running game without scoring it (no worst-read tag, but the rest is there)', async () => {
    const store = new EventStore()
    await playLiveGame(store, 'live-a', 6)
    const quick = handIndex(store, 'live-a', new Map(), { score: false })
    expect(quick).toHaveLength(6)
    expect(quick.every((h) => !h.tags.includes('worst-read'))).toBe(true)
    expect(quick.every((h) => h.pot > 0 && h.headline.length > 10)).toBe(true)
    expect(quick.some((h) => h.tags.includes('biggest-pot'))).toBe(true)
  })
})
