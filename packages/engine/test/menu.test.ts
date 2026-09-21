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

  it('offers a 3x re-raise after an open', () => {
    const s = play(start([10_000, 10_000, 10_000, 10_000]), { type: 'raise', to: 300 })
    expect(ids(s)).toEqual(['fold', 'call', 'min_raise', 'reraise_3x', 'all_in'])
    expect(buildMenu(s).find((o) => o.id === 'reraise_3x')!.label).toBe('Raise to 900')
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
