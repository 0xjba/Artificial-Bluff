import { describe, expect, it } from 'vitest'
import { createHand } from '../src/hand'
import { blindSeats, positions } from '../src/positions'

describe('positions', () => {
  it('names a 5-handed table', () => {
    expect(positions(5, 0)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'CO'])
    expect(positions(5, 3)).toEqual(['BB', 'UTG', 'CO', 'BTN', 'SB'])
  })

  it('names heads-up, 3-handed and full tables', () => {
    expect(positions(2, 0)).toEqual(['BTN', 'BB'])
    expect(positions(2, 1)).toEqual(['BB', 'BTN'])
    expect(positions(3, 0)).toEqual(['BTN', 'SB', 'BB'])
    expect(positions(6, 0)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'])
    expect(positions(10, 0)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP', 'LJ', 'HJ', 'CO'])
  })

  it('agrees with the seats the engine actually posts blinds from', () => {
    for (let n = 2; n <= 10; n++) {
      for (let button = 0; button < n; button++) {
        const state = createHand({
          seats: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, stack: 1000 })),
          buttonIndex: button,
          smallBlind: 50,
          bigBlind: 100,
          seed: 1,
        })
        const sb = state.history.find((h) => h.kind === 'post_sb')!.seatIndex
        const bb = state.history.find((h) => h.kind === 'post_bb')!.seatIndex
        expect(blindSeats(n, button)).toEqual({ sb, bb })
        const names = positions(n, button)
        expect(new Set(names).size).toBe(n)
        expect(names[bb]).toBe('BB')
      }
    }
  })
})
