import type { GameEvent } from '@ab/core'
import { describe, expect, it } from 'vitest'
import { extractHands, playerInfo } from '../src/hands'
import { memorySink, playFixedHand, scripted } from './helpers'

const caller = (id: string) => scripted(id, () => undefined) // checks or calls everything
const board = ['2c', '7d', '9h', 'Js', '4c']

describe('extractHands', () => {
  it('rebuilds a showdown hand: stacks, board and live players at each decision, main-pot shares', async () => {
    // a (BTN) has aces, b (SB) kings, c (BB) queens; everyone checks or calls down.
    const events = await playFixedHand([caller('a'), caller('b'), caller('c')], [['Ah', 'Ad'], ['Kh', 'Kd'], ['Qh', 'Qd']], board)
    const [hand] = extractHands(events)
    expect(hand).toMatchObject({ handId: 'h1', bigBlind: 100, board, showdown: ['a', 'b', 'c'], sawFlop: ['a', 'b', 'c'], folded: [], mainPotWinners: ['a'] })
    expect(hand!.seats.map((s) => [s.playerId, s.position, s.startStack])).toEqual([
      ['a', 'BTN', 10_000],
      ['b', 'SB', 10_000],
      ['c', 'BB', 10_000],
    ])
    const first = hand!.decisions[0]!
    expect(first).toMatchObject({ index: 0, playerId: 'a', street: 'preflop', actionType: 'call', toCall: 100, stackBefore: 10_000, board: [], live: ['a', 'b', 'c'] })
    const sb = hand!.decisions[1]!
    expect(sb).toMatchObject({ playerId: 'b', toCall: 50, stackBefore: 9_950 }) // after posting the small blind
    for (const d of hand!.decisions) expect(d.mainPotShare).toBe(d.playerId === 'a' ? 1 : 0)
    const flop = hand!.decisions.find((d) => d.street === 'flop')!
    expect(flop.board).toEqual(board.slice(0, 3))
    expect(hand!.decisions.find((d) => d.playerId === 'a')!.stackChange).toBe(200) // 10,000 before its first call, 10,200 at the end
    expect(hand!.net).toEqual({ a: 200, b: -100, c: -100 })
    expect(hand!.holes['a']).toEqual(['Ah', 'Ad'])
  })

  it('scores every decision of a player who folds later as 0, and drops them from later live sets', async () => {
    // b calls preflop, checks the flop, then folds to a's bet.
    const bettor = scripted('a', (o) => (o.street === 'flop' ? 'pot_50' : undefined))
    const folder = scripted('b', (o) => (o.street === 'flop' ? 'fold' : undefined))
    const events = await playFixedHand([bettor, folder, caller('c')], [['2h', '3d'], ['Ah', 'Ad'], ['Kh', 'Kd']], board)
    const [hand] = extractHands(events)
    expect(hand!.folded).toEqual(['b'])
    const bs = hand!.decisions.filter((d) => d.playerId === 'b')
    expect(bs.map((d) => d.actionType)).toEqual(['call', 'check', 'fold'])
    expect(bs.every((d) => d.mainPotShare === 0)).toBe(true) // aces folded: 0 even for the preflop call
    const afterFold = hand!.decisions.find((d) => d.index > bs[2]!.index)!
    expect(afterFold.live).toEqual(['a', 'c'])
    expect(hand!.mainPotWinners).toEqual(['c'])
    expect(hand!.showdown).toEqual(['a', 'c'])
  })

  it('splits the main-pot share when the board plays', async () => {
    const events = await playFixedHand([caller('a'), caller('b')], [['2h', '3d'], ['2d', '3h']], ['As', 'Ks', 'Qs', 'Js', 'Ts'])
    const [hand] = extractHands(events)
    expect(hand!.mainPotWinners).toEqual(['b', 'a'])
    for (const d of hand!.decisions) expect(d.mainPotShare).toBe(0.5)
  })

  it('separates interleaved hands and skips unfinished ones', async () => {
    const sinkA = memorySink()
    const sinkB = memorySink()
    const a = await playFixedHand([caller('a'), caller('b')], [['Ah', 'Ad'], ['Kh', 'Kd']], board, 'x', sinkA)
    const b = await playFixedHand([caller('a'), caller('b')], [['Kh', 'Kd'], ['Ah', 'Ad']], board, 'y', sinkB)
    const mixed: GameEvent[] = []
    for (let i = 0; i < Math.max(a.length, b.length); i++) mixed.push(...(a[i] ? [a[i]!] : []), ...(b[i] ? [b[i]!] : []))
    const unfinished = b.filter((e) => e.type !== 'hand_ended').map((e) => ({ ...e, handId: 'z' }) as GameEvent)
    const hands = extractHands([...mixed, ...unfinished])
    expect(hands.map((h) => [h.handId, h.mainPotWinners])).toEqual([
      ['x', ['a']],
      ['y', ['b']],
    ])
  })

  it('takes the main pot as the first pot awarded, with a short all-in stack and a side pot', async () => {
    // a (BTN, 10,000) shoves; b (SB, 1,000) calls all-in with aces; c (BB, 10,000) calls with kings.
    // b wins the 3,000 main pot; c wins the 18,000 side pot from a's queens.
    const shover = scripted('a', () => 'all_in')
    const events = await playFixedHand([shover, caller('b'), caller('c')], [['Qh', 'Qd'], ['Ah', 'Ad'], ['Kh', 'Kd']], board, 'h1', memorySink(), [10_000, 1_000, 10_000])
    const [hand] = extractHands(events)
    expect(hand!.mainPotWinners).toEqual(['b'])
    expect(hand!.net).toEqual({ a: -10_000, b: 2_000, c: 8_000 })
    const byPlayer = new Map(hand!.decisions.map((d) => [d.playerId, d]))
    expect(byPlayer.get('b')!.mainPotShare).toBe(1)
    expect(byPlayer.get('c')!.mainPotShare).toBe(0) // won only the side pot
    // b can only win chips up to its own 1,000: 1,000 from a, 50 of its own, 100 from c.
    expect(byPlayer.get('b')).toMatchObject({ toCall: 950, pot: 10_150, winnablePot: 1_150 })
    // All-in run-out: every decision was preflop, everyone saw the flop and the showdown.
    expect(hand!.decisions.every((d) => d.street === 'preflop' && d.board.length === 0)).toBe(true)
    expect(hand!.sawFlop).toEqual(['a', 'b', 'c'])
    expect(hand!.showdown).toEqual(['a', 'b', 'c'])
    expect(hand!.board).toEqual(board)
  })

  it('keeps hands of different games apart even when their hand ids match', async () => {
    const one = await playFixedHand([caller('a'), caller('b')], [['Ah', 'Ad'], ['Kh', 'Kd']], board, 'hand-1')
    const two = (await playFixedHand([caller('a'), caller('b')], [['Kh', 'Kd'], ['Ah', 'Ad']], board, 'hand-1')).map((e) => ({ ...e, gameId: 'other' }) as GameEvent)
    const hands = extractHands([...one, ...two])
    expect(hands.map((h) => [h.handId, h.mainPotWinners])).toEqual([
      ['hand-1', ['a']],
      ['hand-1', ['b']],
    ])
  })

  it('reads player kinds and models from game_started', () => {
    const info = playerInfo([
      { type: 'game_started', kind: 'study', configHash: 'h', players: [{ id: 'hex', kind: 'jev', model: 'jev-1.13.0' }], gameId: 'g', seq: 1, ts: 0 },
    ])
    expect(info.get('hex')).toEqual({ id: 'hex', kind: 'jev', model: 'jev-1.13.0' })
  })
})
