import { playHand, type EventBody, type EventSink, type GameEvent } from '@ab/core'
import { fullDeck, type Card, type OptionId } from '@ab/engine'
import { NO_USAGE, type Observation, type Player } from '@ab/players'

/** Collects events in memory, stamping seq like the store does. */
export function memorySink(): EventSink & { events: GameEvent[] } {
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

/** Deck dealing `holes` (seat order, dealt from left of the button) and `board`, with burn cards. */
export function arrangeDeck(buttonIndex: number, holes: string[][], board: string[]): Card[] {
  const n = holes.length
  const order = Array.from({ length: n }, (_, k) => (buttonIndex + 1 + k) % n)
  const used = new Set([...holes.flat(), ...board])
  const spare = fullDeck().filter((c) => !used.has(c))
  const top: string[] = []
  for (let round = 0; round < 2; round++) for (const i of order) top.push(holes[i]![round]!)
  top.push(spare.shift()!, board[0]!, board[1]!, board[2]!, spare.shift()!, board[3]!, spare.shift()!, board[4]!)
  return [...(top as Card[]), ...spare]
}

/**
 * A player that picks an option with `choose` (falling back to check, then call), stating the given
 * win probability and confidence, and a made-up cost and latency-free usage.
 */
export function scripted(
  id: string,
  choose: (obs: Observation) => OptionId | undefined,
  said: { winProbability?: number; confidence?: number; costUsd?: number } = {},
): Player {
  return {
    id,
    kind: 'mock',
    model: `scripted/${id}`,
    async decide(obs) {
      const ids = obs.options.map((o) => o.id)
      const wanted = choose(obs)
      const optionId = wanted && ids.includes(wanted) ? wanted : ids.includes('check') ? 'check' : 'call'
      return {
        ok: true,
        decision: { optionId, winProbability: said.winProbability ?? 0.5, confidence: said.confidence ?? 0.5, optionProbabilities: null, reasoning: null },
        usage: { ...NO_USAGE, inputTokens: 100, costUsd: said.costUsd ?? 0 },
        model: `scripted/${id}`,
      }
    },
  }
}

/** Plays one hand of 50/100 blinds, 10,000 chip stacks (unless given), button at seat 0, with a fixed deal. */
export async function playFixedHand(
  players: Player[],
  holes: string[][],
  board: string[],
  handId = 'h1',
  sink = memorySink(),
  stacks: number[] = players.map(() => 10_000),
): Promise<GameEvent[]> {
  await playHand({
    config: {
      seats: players.map((p, i) => ({ id: p.id, stack: stacks[i]! })),
      buttonIndex: 0,
      smallBlind: 50,
      bigBlind: 100,
      seed: 1,
      handId,
      deck: arrangeDeck(0, holes, board),
    },
    players: new Map(players.map((p) => [p.id, p])),
    sink,
    decisionTimeoutMs: 1000,
  })
  return sink.events
}
