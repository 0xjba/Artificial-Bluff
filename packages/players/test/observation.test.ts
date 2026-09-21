import { applyAction, createHand, type HandState } from '@ab/engine'
import { describe, expect, it } from 'vitest'
import { buildObservation } from '../src/observation'

function start(stacks: number[]): HandState {
  return createHand({
    seats: stacks.map((stack, i) => ({ id: `p${i}`, stack })),
    buttonIndex: 0,
    smallBlind: 50,
    bigBlind: 100,
    seed: 5,
    handId: 'hand-7',
  })
}

describe('buildObservation', () => {
  it('describes the spot for the player to act, identifying opponents only by position', () => {
    let s = start([10_000, 10_000, 10_000, 10_000, 10_000])
    s = applyAction(s, { type: 'raise', to: 300 }) // UTG (p3) opens
    const obs = buildObservation(s)
    expect(obs.handId).toBe('hand-7')
    expect(obs.position).toBe('CO')
    expect(obs.hole).toEqual(s.seats[4]!.hole)
    expect(obs.board).toEqual([])
    expect(obs.seats.map((x) => [x.position, x.stack, x.bet, x.status, x.you])).toEqual([
      ['BTN', 10_000, 0, 'active', false],
      ['SB', 9_950, 50, 'active', false],
      ['BB', 9_900, 100, 'active', false],
      ['UTG', 9_700, 300, 'active', false],
      ['CO', 10_000, 0, 'active', true],
    ])
    expect(obs.history).toEqual([
      'preflop: SB posts small blind 50',
      'preflop: BB posts big blind 100',
      'preflop: UTG raises to 300',
    ])
    expect(obs.facts).toEqual({
      smallBlind: 50,
      bigBlind: 100,
      pot: 450,
      toCall: 300,
      potOddsPct: 40,
      effectiveStackBb: 100,
      spr: null,
    })
    expect(obs.options[0]).toEqual({ id: 'fold', label: 'Fold' })
    expect(JSON.stringify(obs)).not.toContain('p3') // no player ids leak
  })

  it('marks all-in and folded seats and lists the flop action', () => {
    // Button p0, SB p1, BB p2, UTG p3 (500 chips) shoves.
    let s = start([10_000, 10_000, 10_000, 500])
    s = applyAction(s, { type: 'raise', to: 500 })
    let obs = buildObservation(s)
    expect(obs.position).toBe('BTN')
    expect(obs.seats[3]!.status).toBe('all_in')
    expect(obs.history.at(-1)).toBe('preflop: UTG raises to 500 (all-in)')
    s = applyAction(s, { type: 'call' }) // BTN calls
    s = applyAction(s, { type: 'fold' }) // SB folds
    s = applyAction(s, { type: 'call' }) // BB calls
    obs = buildObservation(s)
    expect(obs.street).toBe('flop')
    expect(obs.position).toBe('BB')
    expect(obs.board).toHaveLength(3)
    expect(obs.seats[1]!.status).toBe('folded')
    // Pot 500 x 3 + 50 = 1,550; effective = min(9,500, 9,500) = 9,500 -> SPR 6.1.
    expect(obs.facts.pot).toBe(1550)
    expect(obs.facts.spr).toBe(6.1)
    s = applyAction(s, { type: 'check' })
    expect(buildObservation(s).history.at(-1)).toBe('flop: BB checks')
  })

  it('throws when nobody is to act', () => {
    const s = applyAction(start([1000, 1000]), { type: 'fold' })
    expect(() => buildObservation(s)).toThrow(/nobody/)
  })
})
