import type { FallbackKind, GameEvent, PlayerInfo } from '@ab/core'
import type { Action, Card, OptionId, Position, Street } from '@ab/engine'

/** One decision, with what is needed to score it. Built from the event log only. */
export interface DecisionRecord {
  handId: string
  /** Order of this decision within its hand (0 = first). */
  index: number
  playerId: string
  street: Street
  position: Position
  model: string
  optionId: OptionId
  actionType: Action['type']
  chipsIn: number
  /** Pot before the action (every chip committed this hand, current street included). */
  pot: number
  toCall: number
  /** The player's stack just before this decision. */
  stackBefore: number
  /** Board at the decision. */
  board: Card[]
  /** Players still in the hand (not folded) at the decision, actor included, in seat order. */
  live: string[]
  winProbability: number | null
  confidence: number | null
  optionProbabilities: Partial<Record<OptionId, number>> | null
  latencyMs: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  costUsd: number
  retries: number
  fallback: boolean
  fallbackKind: FallbackKind | null
  /**
   * Calibration outcome A: the player's share of the main pot: 1 if they won it alone, 1/k if it was
   * split k ways, 0 if they lost it or folded at any point in the hand (side pots are ignored).
   */
  mainPotShare: number
  /** Chips the player's stack changed by, from just before this decision to the end of the hand. */
  stackChange: number
}

export interface HandRecord {
  handId: string
  bigBlind: number
  /** Seats in table order. */
  seats: Array<{ playerId: string; position: Position; startStack: number }>
  holes: Record<string, Card[]>
  /** Final board. */
  board: Card[]
  decisions: DecisionRecord[]
  /** Players who folded at some point. */
  folded: string[]
  /** Players still in the hand when the flop was dealt (empty if no flop). */
  sawFlop: string[]
  /** Players whose hands were shown down. */
  showdown: string[]
  /** Winners of the main pot (the first pot awarded). */
  mainPotWinners: string[]
  net: Record<string, number>
}

type HandEvent = Extract<GameEvent, { handId: string | null }>

/**
 * Rebuilds complete hands from an event log (events of several hands may interleave, as in a study
 * with parallel tables). Hands without an id, or that never reached hand_ended, are skipped.
 */
export function extractHands(events: readonly GameEvent[]): HandRecord[] {
  const byHand = new Map<string, HandEvent[]>()
  for (const e of events) {
    if (!('handId' in e) || e.handId === null) continue
    const list = byHand.get(e.handId)
    if (list) list.push(e)
    else byHand.set(e.handId, [e])
  }
  const hands: HandRecord[] = []
  for (const [handId, list] of byHand) {
    const hand = buildHand(handId, list)
    if (hand) hands.push(hand)
  }
  return hands
}

function buildHand(handId: string, events: HandEvent[]): HandRecord | null {
  const started = events.find((e) => e.type === 'hand_started')
  const dealt = events.find((e) => e.type === 'cards_dealt')
  const ended = events.find((e) => e.type === 'hand_ended')
  if (!started || started.type !== 'hand_started' || !dealt || dealt.type !== 'cards_dealt' || !ended || ended.type !== 'hand_ended') return null

  const order = started.seats.map((s) => s.playerId)
  const stacks = new Map(started.seats.map((s) => [s.playerId, s.stack]))
  for (const post of started.posts) stacks.set(post.playerId, stacks.get(post.playerId)! - post.amount)
  const position = new Map(started.seats.map((s) => [s.playerId, s.position]))
  const folded = new Set<string>()
  let board: Card[] = []
  let sawFlop: string[] = []
  let showdown: string[] = []
  let mainPotWinners: string[] | null = null
  const drafts: Array<Omit<DecisionRecord, 'mainPotShare' | 'stackChange'>> = []

  for (const e of events) {
    if (e.type === 'street_dealt') {
      board = [...e.board]
      if (e.street === 'flop') sawFlop = order.filter((id) => !folded.has(id))
    } else if (e.type === 'decision') {
      const stackBefore = stacks.get(e.playerId)!
      drafts.push({
        handId,
        index: drafts.length,
        playerId: e.playerId,
        street: e.street,
        position: position.get(e.playerId) ?? e.position,
        model: e.model,
        optionId: e.optionId,
        actionType: e.action.type,
        chipsIn: e.chipsIn,
        pot: e.pot,
        toCall: e.toCall,
        stackBefore,
        board: [...board],
        live: order.filter((id) => !folded.has(id)),
        winProbability: e.winProbability,
        confidence: e.confidence,
        optionProbabilities: e.optionProbabilities,
        latencyMs: e.latencyMs,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        reasoningTokens: e.reasoningTokens,
        costUsd: e.costUsd,
        retries: e.retries,
        fallback: e.fallback,
        fallbackKind: e.fallbackKind,
      })
      stacks.set(e.playerId, stackBefore - e.chipsIn)
      if (e.action.type === 'fold') folded.add(e.playerId)
    } else if (e.type === 'showdown') {
      showdown = order.filter((id) => id in e.hands)
    } else if (e.type === 'pot_awarded') {
      mainPotWinners ??= [...e.winners]
    }
  }
  const winners = mainPotWinners ?? []
  const share = (id: string) => (folded.has(id) || !winners.includes(id) ? 0 : 1 / winners.length)
  return {
    handId,
    bigBlind: started.bigBlind,
    seats: started.seats.map((s) => ({ playerId: s.playerId, position: s.position, startStack: s.stack })),
    holes: Object.fromEntries(Object.entries(dealt.holes).map(([id, cards]) => [id, [...cards]])),
    board,
    decisions: drafts.map((d) => ({ ...d, mainPotShare: share(d.playerId), stackChange: ended.stacks[d.playerId]! - d.stackBefore })),
    folded: order.filter((id) => folded.has(id)),
    sawFlop,
    showdown,
    mainPotWinners: winners,
    net: { ...ended.net },
  }
}

/** Players as announced by the (last) game_started event: id, kind and configured model. */
export function playerInfo(events: readonly GameEvent[]): Map<string, PlayerInfo> {
  const out = new Map<string, PlayerInfo>()
  for (const e of events) if (e.type === 'game_started') for (const p of e.players) out.set(p.id, { ...p })
  return out
}
