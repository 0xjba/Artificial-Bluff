import type { HandRecord, ScoredDecision } from '@ab/analysis'
import type { DuplicateInfo, GameEvent } from '@ab/core'

const COLUMNS = [
  'handId', 'index', 'playerId', 'street', 'position', 'model', 'optionId', 'actionType', 'chipsIn', 'pot', 'winnablePot', 'toCall',
  'stackBefore', 'board', 'live', 'winProbability', 'confidence', 'optionProbabilities', 'latencyMs', 'inputTokens',
  'outputTokens', 'reasoningTokens', 'costUsd', 'retries', 'fallback', 'fallbackKind', 'fallbackReason', 'jevChoice', 'provider',
  'reasoning', 'rawReply', 'at', 'mainPotShare', 'expectedShare',
  'actionGood', 'stackChange',
] as const satisfies ReadonlyArray<keyof ScoredDecision>

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = Array.isArray(value) ? value.join(' ') : typeof value === 'object' ? JSON.stringify(value) : String(value)
  // Text a spreadsheet would run as a formula gets a leading apostrophe (numbers are left alone).
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * One row per decision (RFC 4180 quoting); arrays are space-separated, objects are JSON, and text
 * starting with = + - @ is prefixed with ' so spreadsheets don't evaluate it.
 */
export function decisionsCsv(decisions: readonly ScoredDecision[]): string {
  const lines = [COLUMNS.join(',')]
  for (const d of decisions) lines.push(COLUMNS.map((c) => cell(d[c])).join(','))
  return `${lines.join('\n')}\n`
}

const HAND_COLUMNS = [
  'handId', 'group', 'rotation', 'order', 'seed', 'attempt', 'playerId', 'position', 'hole', 'board', 'startStack', 'net', 'netBb',
  'sawFlop', 'showdown', 'wonMainPot',
] as const

/**
 * One row per analysed hand and player, with the hand's place in the duplicate schedule (group,
 * rotation, deck seed), so bb/100 and the paired contrasts can be recomputed from this file alone.
 */
export function handsCsv(hands: readonly HandRecord[], events: readonly GameEvent[]): string {
  const schedule = new Map<string, DuplicateInfo>()
  for (const e of events) if (e.type === 'hand_started' && e.handId !== null && e.duplicate) schedule.set(e.handId, e.duplicate)
  const lines: string[] = [HAND_COLUMNS.join(',')]
  for (const h of hands) {
    const d = schedule.get(h.handId)
    for (const s of h.seats) {
      const net = h.net[s.playerId] ?? 0
      const row: Record<(typeof HAND_COLUMNS)[number], unknown> = {
        handId: h.handId,
        group: d?.groupIndex,
        rotation: d?.rotation,
        order: d?.order,
        seed: d?.seed,
        attempt: d?.attempt,
        playerId: s.playerId,
        position: s.position,
        hole: h.holes[s.playerId] ?? [],
        board: h.board,
        startStack: s.startStack,
        net,
        netBb: net / h.bigBlind,
        sawFlop: h.sawFlop.includes(s.playerId),
        showdown: h.showdown.includes(s.playerId),
        wonMainPot: h.mainPotWinners.includes(s.playerId),
      }
      lines.push(HAND_COLUMNS.map((c) => cell(row[c])).join(','))
    }
  }
  return `${lines.join('\n')}\n`
}

/** The study's whole event log, one JSON event per line: the source every other file is computed from. */
export const eventsJsonl = (events: readonly GameEvent[]): string => events.map((e) => JSON.stringify(e)).join('\n') + '\n'
