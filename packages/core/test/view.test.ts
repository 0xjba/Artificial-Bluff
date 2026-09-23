import { liveTurboConfig } from '@ab/engine'
import { CallingStation, MockLlm, RandomBot, TagBot, type Player } from '@ab/players'
import { describe, expect, it } from 'vitest'
import type { GameEvent } from '../src/events'
import { runTournamentGame } from '../src/game'
import { EventStore } from '../src/store'
import { applyEvent, buildView, emptyView, withEquity, type TableView } from '../src/view'

const lineup = (): Player[] => [new MockLlm('hex'), new TagBot('pill'), new RandomBot('block', 7), new CallingStation('drip'), new MockLlm('nimbus', 'mock/llm', { failEvery: 9 })]

async function tournament(seed: string): Promise<GameEvent[]> {
  const store = new EventStore()
  await runTournamentGame({ gameId: 'g', players: lineup(), tournament: liveTurboConfig(seed), store, decisionTimeoutMs: 1000, budgetUsd: 100 })
  return store.events('g')
}

const chipsOnTable = (v: TableView) => v.seats.reduce((sum, s) => sum + s.stack, 0) + (v.hand && !v.hand.ended ? v.hand.pot : 0)

describe('table view', () => {
  it('tracks a whole tournament: turns, pots, stacks and chips stay consistent with the log', async () => {
    for (const seed of ['view-1', 'view-2', 'view-3']) {
      const events = await tournament(seed)
      let v = emptyView()
      for (const e of events) {
        if (e.type === 'decision') {
          // The view knows whose turn it is and the pot the player faced.
          expect(v.hand!.toAct).toBe(e.playerId)
          expect(v.hand!.options!.map((o) => o.id)).toContain(e.optionId)
          expect(v.hand!.pot).toBe(e.pot)
          expect(v.seats.find((s) => s.playerId === e.playerId)!.stack).toBeGreaterThanOrEqual(e.chipsIn)
        }
        v = applyEvent(v, e)
        if (v.status === 'running' && v.hand && !v.hand.ended && e.type !== 'pot_awarded') expect(chipsOnTable(v)).toBe(15_000)
        if (e.type === 'hand_ended') {
          for (const [id, stack] of Object.entries(e.stacks)) expect(v.seats.find((s) => s.playerId === id)!.stack).toBe(stack)
          expect(v.seats.every((s) => s.bet === 0)).toBe(true)
        }
        if (e.type === 'street_dealt') expect(v.seats.every((s) => s.bet === 0)).toBe(true)
      }
      const ended = events.at(-1) as Extract<GameEvent, { type: 'game_ended' }>
      expect(v).toMatchObject({ status: 'ended', gameId: 'g', kind: 'live', result: { reason: ended.reason, winner: ended.winner }, lastSeq: ended.seq })
      expect(v.handsPlayed).toBe(ended.handsPlayed)
      for (const id of ended.eliminated) expect(v.seats.find((s) => s.playerId === id)!.stack).toBe(0)
      // Running totals match the log.
      const decisions = events.filter((e): e is Extract<GameEvent, { type: 'decision' }> => e.type === 'decision')
      for (const s of v.seats) {
        const mine = decisions.filter((d) => d.playerId === s.playerId)
        expect(s.decisions).toBe(mine.length)
        expect(s.fallbacks).toBe(mine.filter((d) => d.fallback).length)
        expect(s.costUsd).toBeCloseTo(mine.reduce((sum, d) => sum + d.costUsd, 0), 12)
        expect(s.latencyMsTotal).toBeCloseTo(mine.reduce((sum, d) => sum + d.latencyMs, 0), 9)
      }
      expect(buildView(events)).toEqual(v)
    }
  })

  it('remembers each seat\'s starting stack, so screens can show the net result', async () => {
    const events = await tournament('start')
    const first = events.findIndex((e) => e.type === 'hand_started')
    expect(buildView(events.slice(0, first)).seats.every((s) => s.startingStack === null)).toBe(true)
    const end = buildView(events)
    expect(end.seats.every((s) => s.startingStack === 3000)).toBe(true)
    expect(end.seats.reduce((sum, s) => sum + s.stack - s.startingStack!, 0)).toBe(0) // chips only change hands
  })

  it('shows hole cards, positions, the last action and decision, and marks eliminated seats out', async () => {
    const events = await tournament('view-4')
    const firstDecision = events.findIndex((e) => e.type === 'decision')
    const v = buildView(events.slice(0, firstDecision + 1))
    const d = events[firstDecision] as Extract<GameEvent, { type: 'decision' }>
    expect(v.seats.every((s) => s.hole?.length === 2 && s.position !== null)).toBe(true)
    expect(v.lastDecision).toMatchObject({ playerId: d.playerId, optionId: d.optionId, label: d.label, winProbability: d.winProbability })
    expect(v.seats.find((s) => s.playerId === d.playerId)!.lastAction).toEqual({ street: 'preflop', optionId: d.optionId, label: d.label })
    // After the first elimination, the next hand deals that seat out.
    const out = events.findIndex((e) => e.type === 'hand_started' && e.seats.length < 5)
    if (out >= 0) {
      const later = buildView(events.slice(0, out + 1))
      const missing = later.seats.filter((s) => s.status === 'out')
      expect(missing.length).toBe(5 - (events[out] as Extract<GameEvent, { type: 'hand_started' }>).seats.length)
      expect(missing.every((s) => s.position === null && s.hole === null)).toBe(true)
    }
  })

  it('never modifies the view it is given, and keeps the equity annotation until the hand ends', async () => {
    const events = await tournament('view-5')
    let v = emptyView()
    for (const e of events.slice(0, 40)) {
      const before = JSON.stringify(v)
      const next = applyEvent(v, e)
      expect(JSON.stringify(v)).toBe(before)
      v = next
    }
    const annotated = withEquity(v, { jev: 0.5, pill: 0.5 }, true)
    expect(annotated.equity).toEqual({ jev: 0.5, pill: 0.5 })
    expect(annotated.equityEstimated).toBe(true)
    expect(withEquity(v, null, true).equityEstimated).toBe(false)
    expect(v.equity).toBeNull()
    const handEnd = events.findIndex((e, i) => i >= 40 && e.type === 'hand_ended')
    let w = annotated
    for (const e of events.slice(40, handEnd)) w = applyEvent(w, e)
    expect(w.equity).toEqual({ jev: 0.5, pill: 0.5 })
    expect(applyEvent(w, events[handEnd]!)).toMatchObject({ equity: null, equityEstimated: false })
  })

  it("keeps each hand's own seat order, and closes an open hand when the game stops mid-hand", async () => {
    const events = await tournament('view-6')
    const started = events.find((e): e is Extract<GameEvent, { type: 'hand_started' }> => e.type === 'hand_started')!
    const firstTurn = events.findIndex((e) => e.type === 'turn_started')
    const v = buildView(events.slice(0, firstTurn + 1))
    expect(v.hand!.seatOrder).toEqual(started.seats.map((s) => s.playerId))
    expect(v.hand!.toAct).not.toBeNull()
    const crashed = applyEvent(withEquity(v, { jev: 1 }), {
      type: 'game_ended', reason: 'interrupted', winner: null, stacks: {}, eliminated: [], handsPlayed: 0, gameId: 'g', seq: 9999, ts: 0,
    })
    expect(crashed).toMatchObject({ status: 'ended', equity: null, hand: { ended: true, toAct: null, options: null } })
  })
})
