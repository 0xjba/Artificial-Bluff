import { describe, expect, it } from 'vitest'
import { extractHands } from '../src/hands'
import { playerMetrics, quantile } from '../src/metrics'
import { NO_USAGE, type Player } from '@ab/players'
import { playFixedHand, scripted } from './helpers'

describe('quantile', () => {
  it('interpolates linearly (R type 7)', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(quantile([10, 1, 5], 0.5)).toBe(5)
    expect(quantile([0, 10], 0.95)).toBeCloseTo(9.5, 12)
    expect(quantile([7], 0.95)).toBe(7)
    expect(quantile([], 0.5)).toBeNull()
    expect(() => quantile([1], 2)).toThrow(/q must be/)
  })
})

describe('playerMetrics', () => {
  it('sums cost and computes VPIP, PFR, aggression and showdown rates', async () => {
    const board = ['2c', '7d', '9h', 'Js', '4c']
    // Hand 1: a opens 3bb and bets every street; b calls everything; c folds preflop.
    const aggressor = scripted('a', (o) => (o.street === 'preflop' ? 'open_3bb' : 'pot_50'), { costUsd: 0.01 })
    const callerB = scripted('b', () => undefined, { costUsd: 0.002 })
    const h1 = await playFixedHand([aggressor, callerB, scripted('c', () => 'fold')], [['Ah', 'Ad'], ['Kh', 'Kd'], ['3h', '8s']], board, 'h1')
    // Hand 2: everyone checks or calls, so a limps (VPIP, no PFR) and all three reach showdown.
    const passive = scripted('a', () => undefined, { costUsd: 0.01 })
    const h2 = await playFixedHand([passive, callerB, scripted('c', () => undefined)], [['Ah', 'Ad'], ['Kh', 'Kd'], ['3h', '8s']], board, 'h2')
    const hands = extractHands([...h1, ...h2])

    const a = playerMetrics(hands, 'a')
    expect(a).toMatchObject({ hands: 2, decisions: 8, costPerDecisionUsd: 0.01, meanInputTokens: 100, fallbackRate: 0, retryRate: 0 })
    expect(a.costUsd).toBeCloseTo(0.08, 12)
    expect(a.costPer100HandsUsd).toBeCloseTo(4, 12)
    expect(a.style).toEqual({ vpip: 1, pfr: 0.5, af: null, wtsd: 1 }) // three postflop bets, no calls: AF undefined
    expect(a.latencyP50Ms!).toBeLessThanOrEqual(a.latencyP95Ms!)
    expect(playerMetrics(hands, 'b').style).toEqual({ vpip: 1, pfr: 0, af: 0, wtsd: 1 }) // three postflop calls, no bets
    expect(playerMetrics(hands, 'c').style).toEqual({ vpip: 0, pfr: 0, af: null, wtsd: 1 }) // saw one flop, reached that showdown
    expect(playerMetrics(hands, 'nobody')).toMatchObject({ hands: 0, decisions: 0, costPer100HandsUsd: null, latencyP50Ms: null, style: { vpip: null } })
  })

  it('counts fallbacks by kind', async () => {
    const broken: Player = {
      id: 'c',
      kind: 'mock',
      model: 'broken',
      decide: async () => ({ ok: false, error: 'not JSON', kind: 'model', usage: { ...NO_USAGE, costUsd: 0.001 }, model: 'broken' }),
    }
    const events = await playFixedHand([scripted('a', () => undefined), scripted('b', () => undefined), broken], [['Ah', 'Ad'], ['Kh', 'Kd'], ['3h', '8s']], ['2c', '7d', '9h', 'Js', '4c'])
    const c = playerMetrics(extractHands(events), 'c')
    expect(c.fallbacks).toEqual({ model: 3, infra: 0, timeout: 0, auto: 1 }) // after 3 in a row the seat is auto-played
    expect(c.fallbackRate).toBe(1)
    expect(c.modelFallbackRate).toBe(0.75)
    expect(c.costUsd).toBeCloseTo(0.003, 12) // auto-played decisions make no call
    // Per-decision figures cover the 3 answered decisions only: the auto one (0 ms, $0) would flatter them.
    expect(c.costPerDecisionUsd).toBeCloseTo(0.001, 12)
    expect(c.meanInputTokens).toBe(0)
  })

  it('leaves walks out of VPIP and PFR', async () => {
    const board = ['2c', '7d', '9h', 'Js', '4c']
    const deal = [['Ah', 'Ad'], ['Kh', 'Kd'], ['3h', '8s']]
    // Hand 1: a and b fold, c (big blind) wins a walk without deciding anything.
    const walk = await playFixedHand([scripted('a', () => 'fold'), scripted('b', () => 'fold'), scripted('c', () => undefined)], deal, board, 'w')
    // Hand 2: a raises, c calls it.
    const played = await playFixedHand([scripted('a', (o) => (o.street === 'preflop' ? 'open_3bb' : undefined)), scripted('b', () => 'fold'), scripted('c', () => undefined)], deal, board, 'p')
    const c = playerMetrics(extractHands([...walk, ...played]), 'c')
    expect(c.hands).toBe(2)
    expect(c.style.vpip).toBe(1) // 1 of 1 hand with a preflop decision, not 1 of 2
  })
})
