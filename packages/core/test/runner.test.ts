import { arrangeDeckForTests } from './deck'
import { CallingStation, MockLlm, NO_USAGE, TagBot, type DecideResult, type Player } from '@ab/players'
import type { HandConfig } from '@ab/engine'
import { describe, expect, it } from 'vitest'
import type { DecisionEvent, EventBody, EventSink, GameEvent } from '../src/events'
import { playHand } from '../src/runner'

function memorySink(): EventSink & { events: GameEvent[] } {
  const events: GameEvent[] = []
  return {
    events,
    append(body: EventBody) {
      const e = { ...body, gameId: 'mem', seq: events.length + 1, ts: 0 } as GameEvent
      events.push(e)
      return e
    },
  }
}

function config(ids: string[], stacks = ids.map(() => 10_000), extra: Partial<HandConfig> = {}): HandConfig {
  return { seats: ids.map((id, i) => ({ id, stack: stacks[i]! })), buttonIndex: 0, smallBlind: 50, bigBlind: 100, seed: 11, handId: 'hand-0', ...extra }
}

const byId = (players: Player[]) => new Map(players.map((p) => [p.id, p]))
const decisions = (events: GameEvent[]) => events.filter((e): e is GameEvent & DecisionEvent => e.type === 'decision')

class Scripted implements Player {
  readonly kind = 'mock' as const
  readonly model = 'scripted'
  calls = 0
  constructor(
    readonly id: string,
    private readonly behave: (call: number) => Promise<DecideResult> | DecideResult,
  ) {}
  async decide(): Promise<DecideResult> {
    return this.behave(++this.calls)
  }
}

describe('playHand', () => {
  it('emits a complete, ordered event stream for a hand', async () => {
    const sink = memorySink()
    const players = [new MockLlm('a'), new TagBot('b'), new CallingStation('c')]
    const result = await playHand({ config: config(['a', 'b', 'c']), players: byId(players), sink, decisionTimeoutMs: 1000 })
    const types = sink.events.map((e) => e.type)
    expect(types[0]).toBe('hand_started')
    expect(types[1]).toBe('cards_dealt')
    expect(types.at(-1)).toBe('hand_ended')
    // every decision is preceded by its turn_started
    types.forEach((t, i) => t === 'decision' && expect(types[i - 1]).toBe('turn_started'))
    const started = sink.events[0] as Extract<GameEvent, { type: 'hand_started' }>
    expect(started.seats.map((s) => s.position)).toEqual(['BTN', 'SB', 'BB'])
    expect(started.posts).toEqual([
      { playerId: 'b', blind: 'sb', amount: 50 },
      { playerId: 'c', blind: 'bb', amount: 100 },
    ])
    const ended = sink.events.at(-1) as Extract<GameEvent, { type: 'hand_ended' }>
    expect(ended.stacks).toEqual(result.stacks)
    expect(Object.values(result.stacks).reduce((x, y) => x + y, 0)).toBe(30_000)
  })

  it('falls back to check-or-fold on timeout, invalid option, errors and bad output, labelling who is to blame', async () => {
    const cases: Array<[Player, RegExp, string]> = [
      [new Scripted('x', () => new Promise(() => {})), /^timeout$/, 'timeout'],
      [new Scripted('x', () => ({ ok: true, decision: { optionId: 'bogus' as never, winProbability: null, confidence: null, optionProbabilities: null, reasoning: null }, usage: NO_USAGE, model: 'scripted' })), /^invalid option: bogus$/, 'model'],
      [new Scripted('x', () => Promise.reject(new Error('boom'))), /^boom$/, 'infra'],
      [new Scripted('x', () => ({ ok: false, error: 'invalid output: nope', kind: 'model', usage: NO_USAGE, model: 'scripted' })), /^invalid output/, 'model'],
      [new Scripted('x', () => ({ ok: false, error: 'OpenRouter 503: busy', kind: 'infra', usage: NO_USAGE, model: 'scripted' })), /^OpenRouter 503/, 'infra'],
    ]
    for (const [bad, reason, kind] of cases) {
      const sink = memorySink()
      // x is UTG facing the big blind: fallback must be a fold.
      await playHand({ config: config(['b', 's', 'bb', 'x']), players: byId([new CallingStation('b'), new CallingStation('s'), new CallingStation('bb'), bad]), sink, decisionTimeoutMs: 20, timeoutGraceMs: 10 })
      const d = decisions(sink.events).find((e) => e.playerId === 'x')!
      expect(d).toMatchObject({ optionId: 'fold', fallback: true, fallbackKind: kind, winProbability: null })
      expect(d.fallbackReason).toMatch(reason)
    }
  })

  it('survives players that throw synchronously, return a non-promise, or reject with non-errors', async () => {
    const bad: Array<Player['decide']> = [
      () => {
        throw new Error('sync boom')
      },
      (() => ({ ok: true })) as unknown as Player['decide'],
      () => Promise.reject(undefined),
      () => Promise.reject(null),
      (async () => ({ ok: true, decision: { optionId: 'fold' }, usage: {}, model: 'm' })) as unknown as Player['decide'],
    ]
    for (const decide of bad) {
      const sink = memorySink()
      const x: Player = { id: 'x', kind: 'mock', model: 'm', decide }
      await playHand({ config: config(['b', 's', 'bb', 'x']), players: byId([new CallingStation('b'), new CallingStation('s'), new CallingStation('bb'), x]), sink, decisionTimeoutMs: 50 })
      expect(sink.events.at(-1)!.type).toBe('hand_ended')
      expect(decisions(sink.events).find((e) => e.playerId === 'x')).toMatchObject({ optionId: 'fold', fallback: true })
    }
  })

  it('records a timeout as exactly the time limit, whether or not the player honours the abort', async () => {
    const honours: Player = { id: 'x', kind: 'llm', model: 'm', decide: (_o, signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ ok: false, error: 'aborted', kind: 'infra', usage: NO_USAGE, model: 'm' }))) }
    const ignores: Player = { id: 'x', kind: 'jev', model: 'm', decide: () => new Promise(() => {}) }
    for (const x of [honours, ignores]) {
      const sink = memorySink()
      await playHand({ config: config(['b', 's', 'bb', 'x']), players: byId([new CallingStation('b'), new CallingStation('s'), new CallingStation('bb'), x]), sink, decisionTimeoutMs: 40, timeoutGraceMs: 60 })
      expect(decisions(sink.events).find((e) => e.playerId === 'x')).toMatchObject({ fallbackKind: 'timeout', latencyMs: 40 })
    }
  })

  it('counts a failure with an empty message toward auto', async () => {
    const blank = new Scripted('f', () => Promise.reject(new Error('')))
    const sink = memorySink()
    await playHand({ config: config(['b', 's', 'f']), players: byId([new CallingStation('b'), new CallingStation('s'), blank]), sink, decisionTimeoutMs: 100 })
    expect(decisions(sink.events).filter((d) => d.playerId === 'f').map((d) => d.fallbackKind)).toEqual(['infra', 'infra', 'infra', 'auto'])
    expect(blank.calls).toBe(3)
  })

  it('records the bet each decision faced, including the full big blind after a short post', async () => {
    const sink = memorySink()
    // BB (seat 2) is short with 30 and posts all-in; UTG still faces the full 100.
    await playHand({ config: config(['b', 's', 'bb', 'u'], [10_000, 10_000, 30, 10_000]), players: byId(['b', 's', 'bb', 'u'].map((id) => new CallingStation(id))), sink, decisionTimeoutMs: 100 })
    expect(decisions(sink.events)[0]).toMatchObject({ playerId: 'u', currentBet: 100, toCall: 100, chipsIn: 100 })
  })

  it('stops asking players once stopSpending returns true, finishing the hand as check-or-fold', async () => {
    const asked = new Scripted('x', () => ({ ok: true, decision: { optionId: 'call', winProbability: null, confidence: null, optionProbabilities: null, reasoning: null }, usage: NO_USAGE, model: 'm' }))
    let spent = 0
    const sink = memorySink()
    await playHand({
      config: config(['b', 's', 'bb', 'x']),
      players: byId([new CallingStation('b'), new CallingStation('s'), new CallingStation('bb'), asked]),
      sink,
      decisionTimeoutMs: 100,
      stopSpending: () => spent++ >= 0,
    })
    const all = decisions(sink.events)
    expect(all.every((d) => d.fallbackKind === 'auto' && d.fallbackReason === 'auto: budget cap reached')).toBe(true)
    expect(asked.calls).toBe(0)
    expect(sink.events.at(-1)!.type).toBe('hand_ended')
  })

  it('records what a timed-out player had already spent', async () => {
    // Resolves with its spend only when aborted (like an LLM whose first attempt was billed).
    const slow: Player = {
      id: 'x',
      kind: 'llm',
      model: 'vendor/slow',
      decide: (_obs, signal) =>
        new Promise((resolve) =>
          signal.addEventListener('abort', () =>
            resolve({ ok: false, error: 'aborted', kind: 'infra', usage: { inputTokens: 400, outputTokens: 50, reasoningTokens: 0, costUsd: 0.003, retries: 1 }, model: 'vendor/slow-2026' }),
          ),
        ),
    }
    const sink = memorySink()
    await playHand({ config: config(['b', 's', 'bb', 'x']), players: byId([new CallingStation('b'), new CallingStation('s'), new CallingStation('bb'), slow]), sink, decisionTimeoutMs: 20, timeoutGraceMs: 100 })
    expect(decisions(sink.events).find((e) => e.playerId === 'x')).toMatchObject({
      fallbackKind: 'timeout',
      fallbackReason: 'timeout',
      costUsd: 0.003,
      retries: 1,
      model: 'vendor/slow-2026',
    })
  })

  it('stops asking a player after 3 consecutive failures in a hand', async () => {
    const failing = new Scripted('f', () => ({ ok: false, error: 'provider down', kind: 'infra', usage: NO_USAGE, model: 'scripted' }))
    const sink = memorySink()
    // f is the big blind; the others only check/call, so f is asked preflop, flop, turn and river.
    await playHand({ config: config(['b', 's', 'f']), players: byId([new CallingStation('b'), new CallingStation('s'), failing]), sink, decisionTimeoutMs: 100 })
    const mine = decisions(sink.events).filter((e) => e.playerId === 'f')
    expect(mine.map((d) => d.fallbackReason)).toEqual(['provider down', 'provider down', 'provider down', 'auto: too many failures'])
    expect(mine.map((d) => d.fallbackKind)).toEqual(['infra', 'infra', 'infra', 'auto'])
    expect(mine.every((d) => d.optionId === 'check')).toBe(true)
    expect(failing.calls).toBe(3)
  })

  it('records cost and usage from failed decisions too', async () => {
    const costly = new Scripted('x', () => ({ ok: false, error: 'invalid output: bad', kind: 'model', usage: { inputTokens: 900, outputTokens: 80, reasoningTokens: 30, costUsd: 0.004, retries: 1 }, model: 'vendor/m' }))
    const sink = memorySink()
    await playHand({ config: config(['b', 's', 'bb', 'x']), players: byId([new CallingStation('b'), new CallingStation('s'), new CallingStation('bb'), costly]), sink, decisionTimeoutMs: 100 })
    expect(decisions(sink.events).find((e) => e.playerId === 'x')).toMatchObject({ costUsd: 0.004, retries: 1, inputTokens: 900, reasoningTokens: 30, model: 'vendor/m', fallback: true, fallbackKind: 'model' })
  })

  it('logs the host that served each call, Jev\'s own pick, and the raw reply when an answer was unusable', async () => {
    const usage = { ...NO_USAGE }
    const jev = new Scripted('j', () => ({ ok: true, decision: { optionId: 'call', winProbability: 0.4, confidence: 0.5, optionProbabilities: { call: 0.5 }, reasoning: null, jevChoice: 'fold' }, usage, model: 'jev-1' }))
    const llm = new Scripted('l', () => ({ ok: true, decision: { optionId: 'call', winProbability: 0.4, confidence: 0.5, optionProbabilities: null, reasoning: 'ok' }, usage, model: 'v/m', provider: 'Fireworks' }))
    const bad = new Scripted('x', () => ({ ok: false, error: 'invalid output: bad', kind: 'model', usage, model: 'v/m', provider: 'Groq', rawReply: 'hmm' }))
    const sink = memorySink()
    await playHand({ config: config(['j', 'l', 'x']), players: byId([jev, llm, bad]), sink, decisionTimeoutMs: 100 })
    const first = (id: string) => decisions(sink.events).find((e) => e.playerId === id)
    expect(first('j')).toMatchObject({ jevChoice: 'fold', provider: null, rawReply: null })
    expect(first('l')).toMatchObject({ jevChoice: null, provider: 'Fireworks', rawReply: null })
    expect(first('x')).toMatchObject({ provider: 'Groq', rawReply: 'hmm', fallback: true })
  })

  it('emits each street dealt during an all-in run-out, then showdown and pots', async () => {
    const shove = new Scripted('a', () => ({ ok: true, decision: { optionId: 'all_in', winProbability: 0.8, confidence: 0.9, optionProbabilities: null, reasoning: 'aces' }, usage: NO_USAGE, model: 'scripted' }))
    const sink = memorySink()
    const cfg = config(['a', 'c'], [1000, 1000], { deck: arrangeDeckForTests(0, [['As', 'Ad'], ['Kc', 'Kd']], ['2c', '7h', '9s', 'Jd', '3c']) })
    await playHand({ config: cfg, players: byId([shove, new CallingStation('c')]), sink, decisionTimeoutMs: 100 })
    const streets = sink.events.filter((e) => e.type === 'street_dealt') as Array<Extract<GameEvent, { type: 'street_dealt' }>>
    expect(streets.map((s) => [s.street, s.cards])).toEqual([
      ['flop', ['2c', '7h', '9s']],
      ['turn', ['Jd']],
      ['river', ['3c']],
    ])
    const types = sink.events.map((e) => e.type)
    expect(types.slice(-4)).toEqual(['street_dealt', 'showdown', 'pot_awarded', 'hand_ended'])
    const showdown = sink.events.find((e) => e.type === 'showdown') as Extract<GameEvent, { type: 'showdown' }>
    expect(showdown.hands.a!.hole).toEqual(['As', 'Ad'])
    expect(decisions(sink.events)[0]).toMatchObject({ reasoning: 'aces', winProbability: 0.8, label: 'All-in 1,000', chipsIn: 950 })
  })

  it('handles a hand decided entirely by the blinds', async () => {
    const sink = memorySink()
    await playHand({ config: config(['a', 'b'], [50, 100]), players: byId([new CallingStation('a'), new CallingStation('b')]), sink, decisionTimeoutMs: 100 })
    const types = sink.events.map((e) => e.type)
    expect(types).not.toContain('decision')
    expect(types.filter((t) => t === 'street_dealt')).toHaveLength(3)
    expect(types.at(-1)).toBe('hand_ended')
  })

  it('paces live play by sleeping the rest of paceMs after each decision', async () => {
    let clock = 0
    const slept: number[] = []
    const slow = new Scripted('x', async () => {
      clock += 300
      return { ok: true, decision: { optionId: 'fold', winProbability: null, confidence: null, optionProbabilities: null, reasoning: null }, usage: NO_USAGE, model: 'scripted' }
    })
    const sink = memorySink()
    await playHand({
      config: config(['b', 's', 'bb', 'x']),
      players: byId([new CallingStation('b'), new CallingStation('s'), new CallingStation('bb'), slow]),
      sink,
      decisionTimeoutMs: 5000,
      paceMs: 2000,
      now: () => clock,
      sleep: async (ms) => {
        slept.push(ms)
      },
    })
    expect(slept[0]).toBe(1700)
    expect(decisions(sink.events)[0]!.latencyMs).toBe(300)
  })

  it('records study hands\' place in the duplicate schedule on hand_started', async () => {
    const sink = memorySink()
    const duplicate = { groupIndex: 3, rotation: 2, order: 4, seed: 123, attempt: 1 }
    await playHand({ config: config(['a', 'b']), players: byId([new CallingStation('a'), new CallingStation('b')]), sink, decisionTimeoutMs: 100, duplicate })
    expect(sink.events[0]).toMatchObject({ type: 'hand_started', duplicate })
  })

  it('rejects a config with a seat that has no player', async () => {
    await expect(playHand({ config: config(['a', 'b']), players: byId([new CallingStation('a')]), sink: memorySink(), decisionTimeoutMs: 10 })).rejects.toThrow(/no player for seat b/)
  })
})
