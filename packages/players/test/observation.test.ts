import { applyAction, buildMenu, createHand, deriveSeed, describeHand, mulberry32, type HandState } from '@ab/engine'
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
    expect('handId' in obs).toBe(false) // the hand counter is not shown to players
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

  it('caps the amount to call at the stack and prices pot odds on the winnable pot', () => {
    // BTN has 1,000; UTG raises to 10,000. BTN can only call 1,000 all-in.
    let s = start([1000, 10_000, 10_000, 10_000])
    s = applyAction(s, { type: 'raise', to: 10_000 })
    const obs = buildObservation(s)
    expect(obs.position).toBe('BTN')
    expect(obs.facts.toCall).toBe(1000)
    expect(obs.options.find((o) => o.id === 'call')!.label).toBe('Call all-in 1,000')
    // Winnable pot: SB 50 + BB 100 + UTG's first 1,000 = 1,150. Odds 1,000 / 2,150.
    expect(obs.facts.potOddsPct).toBe(46.5)
  })

  it('describes a blind posted all-in', () => {
    const s = start([10_000, 30, 10_000])
    expect(buildObservation(s).history[0]).toBe('preflop: SB posts small blind 30 (all-in)')
  })

  it('keeps SPR fixed for the whole street', () => {
    let s = start([10_000, 10_000, 10_000])
    s = applyAction(s, { type: 'call' })
    s = applyAction(s, { type: 'call' })
    s = applyAction(s, { type: 'check' }) // flop: pot 300, SB first
    const first = buildObservation(s).facts.spr
    s = applyAction(s, { type: 'raise', to: 200 }) // SB bets 200
    expect(buildObservation(s).facts.spr).toBe(first)
    expect(first).toBe(33) // 9,900 / 300
  })

  it('never reveals opponents\' hole cards or undealt cards', () => {
    for (let h = 0; h < 500; h++) {
      const rand = mulberry32(deriveSeed('leak', h))
      let s = start([10_000, 10_000, 10_000, 10_000, 10_000])
      while (!s.complete) {
        const obs = buildObservation(s)
        const text = JSON.stringify(obs)
        const me = s.seats[s.toAct!]!
        const hidden = [...s.seats.filter((x) => x !== me).flatMap((x) => x.hole), ...s.deck]
        for (const card of hidden) expect(text).not.toContain(`"${card}"`)
        const menu = buildMenu(s)
        s = applyAction(s, menu[Math.floor(rand() * menu.length)]!.action)
      }
    }
  })

  it('throws when nobody is to act', () => {
    const s = applyAction(start([1000, 1000]), { type: 'fold' })
    expect(() => buildObservation(s)).toThrow(/nobody/)
  })

  it('adds what the player holds only when the game turns hand facts on, from their own cards only', () => {
    const s = start([10_000, 10_000, 10_000])
    const plain = buildObservation(s)
    expect(plain.facts).not.toHaveProperty('hand')
    const withFacts = buildObservation(s, buildMenu(s), { handFacts: true })
    expect(withFacts.facts.hand).toEqual(describeHand(withFacts.hole, withFacts.board))
    expect(withFacts.facts.hand!.made).toMatch(/suited|offsuit|pair of/)
  })
})
