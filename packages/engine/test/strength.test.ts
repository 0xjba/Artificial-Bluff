import { describe, expect, it } from 'vitest'
import type { Card } from '../src/cards'
import { PREFLOP_EQUITY } from '../src/preflop-table'
import { describeHand, startingHand } from '../src/strength'

const c = (s: string) => s.split(' ') as Card[]

describe('the starting-hand table', () => {
  it('has all 169 starting hands, each against one random hand, close to the published figures', () => {
    expect(Object.keys(PREFLOP_EQUITY)).toHaveLength(169)
    // Published all-in equities against one random hand.
    const published: Record<string, number> = { AA: 0.852, KK: 0.824, AKs: 0.67, AKo: 0.654, '72o': 0.346, '32o': 0.323, '22': 0.503 }
    for (const [hand, eq] of Object.entries(published)) expect(Math.abs(PREFLOP_EQUITY[hand]! - eq), hand).toBeLessThan(0.01)
  })
})

describe('startingHand', () => {
  it('names the hand and ranks it among all 1,326 starting hands', () => {
    expect(startingHand(c('Ah Ad'))).toEqual({ hand: 'AA', name: 'a pair of aces', topPct: 1 })
    expect(startingHand(c('Kd Ad'))).toMatchObject({ hand: 'AKs', name: 'ace-king suited' })
    // Against one random hand the weakest is three-deuce offsuit; seven-deuce's name comes from multiway pots.
    expect(startingHand(c('3c 2d'))).toMatchObject({ hand: '32o', name: 'three-deuce offsuit', topPct: 100 })
    expect(startingHand(c('7c 2d'))).toMatchObject({ hand: '72o', name: 'seven-deuce offsuit' })
    expect(startingHand(c('7c 2d')).topPct).toBeGreaterThan(90)
    // Order doesn't matter, and stronger hands rank nearer the top.
    expect(startingHand(c('Td Jd'))).toEqual(startingHand(c('Jd Td')))
    expect(startingHand(c('Qs Qh')).topPct).toBeLessThan(startingHand(c('9s 9h')).topPct)
  })
})

describe('describeHand', () => {
  it('before the flop, gives the starting hand and its rank', () => {
    expect(describeHand(c('Ah Kh'), [])).toEqual({ made: 'ace-king suited', startingHandTopPct: startingHand(c('Ah Kh')).topPct })
  })

  it('names a pair by where it sits on the board', () => {
    expect(describeHand(c('Kh Qd'), c('Ks 7c 2d')).made).toBe('one pair: kings (top pair, queen kicker)')
    expect(describeHand(c('7h Qd'), c('Ks 7c 2d')).made).toBe('one pair: sevens (second pair)')
    expect(describeHand(c('2h Qd'), c('Ks 7c 2d')).made).toBe('one pair: deuces (bottom pair)')
    expect(describeHand(c('Ah Ad'), c('Ks 7c 2d')).made).toBe('one pair: aces (overpair)')
    expect(describeHand(c('5h 5d'), c('Ks 7c 2d')).made).toBe('one pair: fives (underpair)')
    // A pair on the board is everyone's: the player's own cards give only high card.
    expect(describeHand(c('Ah 9d'), c('Ks Kc 2d')).made).toBe('one pair: kings (on the board), ace high')
  })

  it('names bigger hands, and says when the board plays them', () => {
    expect(describeHand(c('Kh Kd'), c('Ks 7c 2d')).made).toBe('three of a kind')
    expect(describeHand(c('9h 8h'), c('7h 6h 5h')).made).toBe('straight flush')
    expect(describeHand(c('9h 8h'), c('7h 6h 2h')).made).toBe('flush')
    expect(describeHand(c('2c 3d'), c('Ah Kh Qh Jh Th')).made).toBe('straight flush (the board plays)')
  })

  it('finds draws and counts the cards that complete them', () => {
    const flush = describeHand(c('Ah 5h'), c('Kh 9h 2c'))
    expect(flush.draws).toEqual(['flush draw'])
    expect(flush.outs).toBe(9)
    const oesd = describeHand(c('9c 8d'), c('7h 6s 2c'))
    expect(oesd.draws).toEqual(['open-ended straight draw'])
    expect(oesd.outs).toBe(8)
    const gutshot = describeHand(c('9c 8d'), c('6h 5s Kc'))
    expect(gutshot.draws).toEqual(['gutshot straight draw'])
    expect(gutshot.outs).toBe(4)
    // Both at once: 9 flush cards and 8 straight cards, two of which are both, count once.
    const combo = describeHand(c('9h 8h'), c('7h 6c 2h'))
    expect(combo.draws).toEqual(['flush draw', 'open-ended straight draw'])
    expect(combo.outs).toBe(15)
  })

  it('has no draws once the cards are all out, or when the player already has the hand', () => {
    expect(describeHand(c('Ah 5h'), c('Kh 9h 2c 3d Js'))).not.toHaveProperty('draws')
    expect(describeHand(c('Ah 5h'), c('Kh 9h 2h')).draws).toEqual([])
    // A flush that would be all on the board isn't the player's draw.
    expect(describeHand(c('Qc 8d'), c('Kh 9h 2h 3h')).draws).toEqual([])
    // But the player's own cards can still draw on that board: any four but the heart makes A-2-3-4-5.
    expect(describeHand(c('Ac 5d'), c('Kh 9h 2h 3h'))).toMatchObject({ draws: ['gutshot straight draw'], outs: 3 })
  })
})
