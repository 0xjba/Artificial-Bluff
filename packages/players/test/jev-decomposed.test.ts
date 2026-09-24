import { createHand } from '@ab/engine'
import { describe, expect, it } from 'vitest'
import { decomposedMove, JevPlayer, STRENGTH_INSTRUCTIONS, STRENGTH_LEVELS, WIN_INSTRUCTIONS } from '../src/jev/jev-player'
import { buildObservation } from '../src/observation'
import type { Observation } from '../src/types'

const signal = new AbortController().signal

/** A spot with the given price and options; heads-up unless `live` says otherwise. */
function spot(toCall: number, potOddsPct: number, options: string[], live = 2): Observation {
  const base = buildObservation(createHand({ seats: [{ id: 'a', stack: 10_000 }, { id: 'b', stack: 10_000 }], buttonIndex: 0, smallBlind: 50, bigBlind: 100, seed: 2 }))
  const seats = Array.from({ length: Math.max(live, 2) }, (_, i) => ({ ...base.seats[0]!, you: i === 0, status: 'active' as const }))
  return { ...base, seats, facts: { ...base.facts, toCall, potOddsPct }, options: options.map((id) => ({ id: id as never, label: id })) }
}

describe('decomposedMove', () => {
  const facing = spot(100, 25, ['fold', 'call', 'reraise_3x', 'min_raise', 'all_in'])
  const free = spot(0, 0, ['check', 'pot_33', 'pot_50', 'pot_75', 'all_in'])

  it('folds when its chance of winning is below the pot odds, and calls when it is not', () => {
    expect(decomposedMove(facing, 0.2, 2)).toBe('fold')
    expect(decomposedMove(facing, 0.3, 2)).toBe('call')
  })

  it('raises only a strong hand that is clearly ahead of its fair share', () => {
    // Heads-up the fair share is 50%: a raise needs strength 3 or more and at least 65%.
    expect(decomposedMove(facing, 0.7, 3.2)).toBe('reraise_3x')
    expect(decomposedMove(facing, 0.6, 3.2)).toBe('call') // strong, but not far enough ahead
    expect(decomposedMove(facing, 0.9, 2.6)).toBe('call') // ahead, but the hand isn't strong
  })

  it('bets when nobody has, on the same test, and checks otherwise', () => {
    expect(decomposedMove(free, 0.7, 3.5)).toBe('pot_75')
    expect(decomposedMove(free, 0.4, 3.5)).toBe('check')
  })

  it('counts the players still in: three-handed a third is a fair share', () => {
    const threeWay = spot(0, 0, ['check', 'pot_50'], 3)
    expect(decomposedMove(threeWay, 0.5, 3)).toBe('pot_50') // 50% against a fair share of 33%
    expect(decomposedMove(spot(0, 0, ['check', 'pot_50'], 2), 0.5, 3)).toBe('check')
  })

  it('picks the preferred size the menu offers, and shoves only when that is the only raise', () => {
    expect(decomposedMove(spot(0, 0, ['check', 'open_2_5bb', 'open_3bb', 'min_raise', 'all_in']), 0.9, 4)).toBe('open_3bb')
    expect(decomposedMove(spot(100, 10, ['fold', 'call', 'all_in']), 0.9, 4)).toBe('all_in')
    // Nothing to call and nothing to bet: checks; nothing free and no call either: folds.
    expect(decomposedMove(spot(0, 0, ['check']), 0.9, 4)).toBe('check')
  })
})

describe('JevPlayer, decomposed', () => {
  const obs = buildObservation(createHand({ seats: [{ id: 'a', stack: 1000 }, { id: 'b', stack: 1000 }], buttonIndex: 0, smallBlind: 50, bigBlind: 100, seed: 2 }))
  const body = (win: number, strength: number) => ({
    model: 'jev-1.13.0',
    answers: {
      win: { type: 'noul', noul: win },
      strength: { type: 'score', score: strength, confidence: 0.62, legend: {}, probabilities: {} },
    },
    usage: { input_tokens: 700, output_tokens: 2 },
  })
  const fakeFetch = (reply: unknown) => {
    const requests: Array<Record<string, unknown>> = []
    const fn = async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init!.body)))
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return { fn, requests }
  }

  it('asks two narrow questions in one request, and lets code choose the move', async () => {
    const fake = fakeFetch(body(0.2, 1.1))
    const jev = new JevPlayer({ id: 'hex', model: 'jev-1.13.0', mode: 'decomposed', client: { apiKey: 'test', fetch: fake.fn } })
    const res = await jev.decide(obs, signal)
    const questions = fake.requests[0]!.questions as Record<string, { type: string; instructions: string; criteria?: unknown }>
    expect(Object.keys(questions).sort()).toEqual(['strength', 'win'])
    expect(questions.win).toMatchObject({ type: 'noul', instructions: WIN_INSTRUCTIONS })
    expect(questions.strength).toMatchObject({ type: 'score', instructions: STRENGTH_INSTRUCTIONS, criteria: [...STRENGTH_LEVELS] })
    // 20% to win against pot odds of 25% (50 to call into 150): a fold, decided in code.
    expect(res).toMatchObject({ ok: true, decision: { optionId: 'fold', winProbability: 0.2, confidence: 0.62, optionProbabilities: null } })
    expect(res.ok && res.decision.reasoning).toBe('strength 1.1 of 4, win 20% against pot odds 25%: fold')
    expect(res.ok && res.decision).not.toHaveProperty('jevChoice')
  })

  it('treats a missing or broken answer as the API\'s fault, not a move', async () => {
    const broken = { ...body(0.5, 2), answers: { win: { type: 'noul', noul: 0.5 } } }
    const jev = new JevPlayer({ id: 'hex', model: 'jev-1.13.0', mode: 'decomposed', client: { apiKey: 'test', fetch: fakeFetch(broken).fn } })
    expect(await jev.decide(obs, signal)).toMatchObject({ ok: false, kind: 'infra' })
  })
})
