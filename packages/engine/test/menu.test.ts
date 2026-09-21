import { describe, expect, it } from 'vitest'
import { applyAction, createHand } from '../src/hand'
import { buildMenu } from '../src/menu'
import type { Action, HandState } from '../src/types'

function start(stacks: number[], buttonIndex = 0): HandState {
  return createHand({
    seats: stacks.map((stack, i) => ({ id: `p${i}`, stack })),
    buttonIndex,
    smallBlind: 50,
    bigBlind: 100,
    seed: 3,
  })
}
const play = (s: HandState, ...a: Action[]) => a.reduce(applyAction, s)
const ids = (s: HandState) => buildMenu(s).map((o) => o.id)

describe('buildMenu', () => {
  it('offers opening sizes preflop when unopened', () => {
    const menu = buildMenu(start([10_000, 10_000, 10_000, 10_000]))
    expect(menu.map((o) => [o.id, o.label])).toEqual([
      ['fold', 'Fold'],
      ['call', 'Call 100'],
      ['min_raise', 'Raise to 200'],
      ['open_2_5bb', 'Raise to 250'],
      ['open_3bb', 'Raise to 300'],
      ['open_4bb', 'Raise to 400'],
      ['all_in', 'All-in 10,000'],
    ])
  })

  it('offers 2.5x and 3x re-raises after an open', () => {
    const s = play(start([10_000, 10_000, 10_000, 10_000]), { type: 'raise', to: 300 })
    expect(buildMenu(s).map((o) => [o.id, o.label])).toEqual([
      ['fold', 'Fold'],
      ['call', 'Call 300'],
      ['min_raise', 'Raise to 500'],
      ['reraise_2_5x', 'Raise to 750'],
      ['reraise_3x', 'Raise to 900'],
      ['all_in', 'All-in 10,000'],
    ])
  })

  it('adds 1 bb per limper to opening sizes (isolation raise)', () => {
    // 6-handed, button p0; UTG p3, p4, p5 limp. p0 to act, pot 450.
    let s = start([10_000, 10_000, 10_000, 10_000, 10_000, 10_000])
    s = play(s, { type: 'call' }, { type: 'call' }, { type: 'call' })
    expect(s.toAct).toBe(0)
    const sized = buildMenu(s).filter((o) => o.id.startsWith('open_')).map((o) => o.label)
    expect(sized).toEqual(['Raise to 550', 'Raise to 600', 'Raise to 700'])
  })

  it('adds 1x per caller to re-raise sizes (squeeze)', () => {
    // UTG p3 opens 300, p0 (button) calls; SB p1 to act.
    const s = play(start([10_000, 10_000, 10_000, 10_000]), { type: 'raise', to: 300 }, { type: 'call' })
    expect(s.toAct).toBe(1)
    const sized = buildMenu(s).filter((o) => o.id.startsWith('reraise_')).map((o) => [o.id, o.label])
    expect(sized).toEqual([
      ['reraise_2_5x', 'Raise to 1,050'],
      ['reraise_3x', 'Raise to 1,200'],
    ])
  })

  it('offers a standard-sized 4-bet', () => {
    let s = start([10_000, 10_000, 10_000, 10_000])
    s = play(s, { type: 'raise', to: 300 }, { type: 'fold' }, { type: 'fold' }, { type: 'raise', to: 900 })
    expect(s.toAct).toBe(3)
    expect(buildMenu(s).find((o) => o.id === 'reraise_2_5x')!.label).toBe('Raise to 2,250')
  })

  it('sizes re-raises sensibly after an incomplete all-in raise', () => {
    // UTG p3 shoves 150 (a short raise); p0 to act faces 150: min raise 250, 2.5x 375, 3x 450.
    const s = play(start([10_000, 10_000, 10_000, 150]), { type: 'raise', to: 150 })
    expect(buildMenu(s).map((o) => o.label)).toEqual([
      'Fold',
      'Call 150',
      'Raise to 250',
      'Raise to 375',
      'Raise to 450',
      'All-in 10,000',
    ])
  })

  it('rounds to the small blind when the big blind is not a multiple of 25', () => {
    const s = createHand({
      seats: [10_000, 10_000, 10_000].map((stack, i) => ({ id: `p${i}`, stack })),
      buttonIndex: 0,
      smallBlind: 15,
      bigBlind: 30,
      seed: 1,
    })
    const sized = buildMenu(s).filter((o) => o.id.startsWith('open_')).map((o) => o.label)
    expect(sized).toEqual(['Raise to 75', 'Raise to 90', 'Raise to 120'])
  })

  it('drops sizes within 5% of one already offered', () => {
    // Flop: p1 bets 100, p0 raises to 400. p1 faces a raise: min 700, pot_33 would be 725.
    let s = start([10_000, 10_000])
    s = play(s, { type: 'call' }, { type: 'check' }, { type: 'raise', to: 100 }, { type: 'raise', to: 400 })
    const amounts = buildMenu(s)
      .filter((o) => o.action.type === 'raise')
      .map((o) => (o.action as { to: number }).to)
    for (let i = 1; i < amounts.length; i++) expect(amounts[i]! - amounts[i - 1]!).toBeGreaterThan(0.05 * amounts[i - 1]!)
    expect(amounts).not.toContain(725)
  })

  it('drops sizes within 5% of all-in', () => {
    // Heads-up 75/150: raise to 600 and call, so the flop pot is 1,200 with 1,865 behind.
    // pot_150 would be Bet 1,800, within 5% of All-in 1,865, so it must be dropped.
    let s = createHand({
      seats: [
        { id: 'a', stack: 2465 },
        { id: 'b', stack: 2465 },
      ],
      buttonIndex: 0,
      smallBlind: 75,
      bigBlind: 150,
      seed: 1,
    })
    s = play(s, { type: 'raise', to: 600 }, { type: 'call' })
    const menu = buildMenu(s)
    expect(menu.map((o) => o.label)).not.toContain('Bet 1,800')
    const allIn = (menu.find((o) => o.id === 'all_in')!.action as { to: number }).to
    for (const o of menu) {
      if (o.action.type === 'raise' && o.id !== 'all_in') expect(allIn - o.action.to).toBeGreaterThan(0.05 * o.action.to)
    }
  })

  it('rejects a bad chipUnit', () => {
    expect(() => buildMenu(start([1000, 1000]), { chipUnit: 0 })).toThrow(/chipUnit/)
  })

  it('offers pot-fraction bets postflop, merging sizes that collide', () => {
    let s = start([10_000, 10_000])
    s = play(s, { type: 'call' }, { type: 'check' }) // flop, pot 200, BB to act
    // pot_33 (75) is below the 100 minimum and pot_50 (100) equals min_raise, so both drop out.
    expect(buildMenu(s).map((o) => [o.id, o.label])).toEqual([
      ['check', 'Check'],
      ['min_raise', 'Bet 100'],
      ['pot_75', 'Bet 150'],
      ['pot_100', 'Bet 200'],
      ['pot_150', 'Bet 300'],
      ['all_in', 'All-in 9,900'],
    ])
  })

  it('sizes raises against the pot after calling', () => {
    let s = start([10_000, 10_000])
    s = play(s, { type: 'call' }, { type: 'check' }, { type: 'raise', to: 200 })
    // Pot 400 incl. the bet; to call 200; pot-sized raise = 200 + (400 + 200) = 800.
    expect(buildMenu(s).find((o) => o.id === 'pot_100')!.action).toEqual({ type: 'raise', to: 800 })
  })

  it('only offers all-in when the stack cannot make a full raise', () => {
    const s = start([150, 10_000, 10_000])
    expect(ids(s)).toEqual(['fold', 'call', 'all_in'])
  })

  it('labels a call that puts the player all-in', () => {
    const s = createHand({
      seats: [
        { id: 'a', stack: 10_000 },
        { id: 'b', stack: 300 },
      ],
      buttonIndex: 0,
      smallBlind: 50,
      bigBlind: 100,
      seed: 1,
    })
    const afterShove = applyAction(s, { type: 'raise', to: 1000 })
    expect(buildMenu(afterShove).map((o) => o.label)).toEqual(['Fold', 'Call all-in 200'])
  })

  it('every option is legal', () => {
    let s = start([10_000, 10_000, 10_000])
    for (const o of buildMenu(s)) expect(() => applyAction(s, o.action)).not.toThrow()
    s = play(s, { type: 'raise', to: 300 }, { type: 'call' }, { type: 'call' })
    for (const o of buildMenu(s)) expect(() => applyAction(s, o.action)).not.toThrow()
  })

  it('returns nothing when the hand is over', () => {
    const s = play(start([1000, 1000]), { type: 'fold' })
    expect(buildMenu(s)).toEqual([])
  })
})
