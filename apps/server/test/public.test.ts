import type { GameEvent, GameRow } from '@ab/core'
import { describe, expect, it } from 'vitest'
import { publicEvent, publicGame } from '../src/public'

const row = (status: GameRow['status']): GameRow => ({ id: 'g', kind: 'live', createdAt: 1, status, config: { tournament: { seed: 'secret' } }, configHash: 'h', endedAt: null })

describe('public views', () => {
  it('withholds a running game config (its seeds reveal the cards to come) and publishes it afterwards', () => {
    expect(publicGame(row('running'))).toMatchObject({ id: 'g', configHash: 'h', config: null })
    expect(publicGame(row('ended')).config).toEqual({ tournament: { seed: 'secret' } })
    expect(publicGame(row('interrupted')).config).toEqual({ tournament: { seed: 'secret' } })
  })

  it("hides a running study hand's deck seed, and nothing else", () => {
    const e = {
      type: 'hand_started', handId: '0:0#1', buttonIndex: 0, smallBlind: 50, bigBlind: 100, seats: [], posts: [],
      duplicate: { groupIndex: 0, rotation: 0, order: 1, seed: 12345, attempt: 1 }, gameId: 's', seq: 1, ts: 0,
    } as GameEvent
    expect(publicEvent(e, true)).toMatchObject({ duplicate: { groupIndex: 0, seed: 0 } })
    expect(publicEvent(e, false)).toBe(e)
    const dealt = { type: 'cards_dealt', handId: 'h', holes: { a: ['As', 'Kd'] }, gameId: 'g', seq: 2, ts: 0 } as GameEvent
    expect(publicEvent(dealt, true)).toBe(dealt) // spectators see every hole card
  })
})
