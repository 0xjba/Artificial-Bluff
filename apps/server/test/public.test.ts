import type { GameEvent, GameRow } from '@ab/core'
import { describe, expect, it } from 'vitest'
import { isOver, publicEvent, publicGame, WITHHELD_SEED } from '../src/public'

const row = (status: GameRow['status']): GameRow => ({ id: 'g', kind: 'live', createdAt: 1, status, config: { tournament: { seed: 'secret' } }, configHash: 'h', endedAt: null })

describe('public views', () => {
  it('withholds a config (its seeds reveal the cards to come) until the game is over for good', () => {
    expect(publicGame(row('running'))).toMatchObject({ id: 'g', configHash: 'h', config: null })
    expect(publicGame(row('ended')).config).toEqual({ tournament: { seed: 'secret' } })
    expect(publicGame(row('interrupted')).config).toEqual({ tournament: { seed: 'secret' } }) // live games never resume
    const study = (status: GameRow['status']): GameRow => ({ ...row(status), kind: 'study' })
    expect(isOver(study('interrupted'))).toBe(false) // a stopped study can be resumed: its master seed stays secret
    expect(publicGame(study('interrupted')).config).toBeNull()
    expect(publicGame(study('ended')).config).not.toBeNull()
  })

  it("withholds a study hand's deck seed until the game is over, and nothing else", () => {
    const e = {
      type: 'hand_started', handId: '0:0#1', buttonIndex: 0, smallBlind: 50, bigBlind: 100, seats: [], posts: [],
      duplicate: { groupIndex: 0, rotation: 0, order: 1, seed: 12345, attempt: 1 }, gameId: 's', seq: 1, ts: 0,
    } as GameEvent
    expect(publicEvent(e, false)).toMatchObject({ duplicate: { groupIndex: 0, seed: WITHHELD_SEED } })
    expect(publicEvent(e, true)).toBe(e)
    const dealt = { type: 'cards_dealt', handId: 'h', holes: { a: ['As', 'Kd'] }, gameId: 'g', seq: 2, ts: 0 } as GameEvent
    expect(publicEvent(dealt, false)).toBe(dealt) // spectators see every hole card
  })
})
