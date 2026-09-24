import { applyEvent, buildView, emptyView, type GameEvent, type TableView } from '@ab/core/view'
import { describe, expect, it } from 'vitest'
import { spread, stepFrom } from '../lib/spread'
import { BOARD_STAGGER_MS, boardDelay, DEAL_STEP_MS, holeDelay, wonHand } from '../lib/deal'
import { availableFiles, latestStudy, REPORT_FILES, studyKind, type ReportEntry } from '../lib/reports'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initialFeed, LOG_LIMIT, reduceFeed } from '../lib/feed'
import { card, chips, fallbackNotice, ms, pct, shortModel, usd } from '../lib/format'
import { logLine } from '../lib/log'
import { BIG_LOSS_BB, seatMoment } from '../lib/moments'
import { soundFor } from '../lib/sounds'
import { mockGame } from './fixtures'

const name = (id: string) => id.toUpperCase()

describe('format', () => {
  it('formats chips, dollars, times, percentages, cards and models', () => {
    expect(chips(12500)).toBe('12,500')
    expect(usd(0)).toBe('$0')
    expect(usd(0.0000084)).toBe('$0.00000840') // three significant digits
    expect(usd(1.5)).toBe('$1.50')
    expect(ms(null)).toBe('–')
    expect(ms(0.4)).toBe('<1 ms')
    expect(ms(850)).toBe('850 ms')
    expect(ms(1240)).toBe('1.24 s')
    expect(pct(0.4567)).toBe('46%')
    expect(card('Th')).toEqual({ rank: '10', suit: '♥', red: true })
    expect(card('As')).toEqual({ rank: 'A', suit: '♠', red: false })
    expect(shortModel('anthropic/claude-sonnet-5')).toBe('claude-sonnet-5')
  })
})

describe('seatMoment', () => {
  it('follows a whole game: deciding on their turn, their last action after, won or lost at the end', async () => {
    const events = await mockGame(6)
    let v = emptyView()
    const seen = new Set<string>()
    for (const e of events) {
      v = applyEvent(v, e)
      for (const s of v.seats) {
        const m = seatMoment(v, s.playerId)
        seen.add(m.moment)
        if (v.hand?.toAct === s.playerId) expect(m.moment).toBe('deciding')
        if (s.status === 'folded' && v.hand && !v.hand.ended) expect(m.moment).toBe('fold')
        if (m.jevDecided) expect(s.kind).toBe('jev')
      }
      if (e.type === 'hand_ended') {
        for (const a of v.hand!.awards) for (const w of a.winners) expect(seatMoment(v, w).moment).toBe('won')
      }
    }
    expect(seen).toContain('deciding')
    expect(seen).toContain('fold')
    expect(seen).toContain('won')
  })

  it('marks eliminated seats, big losses and fallbacks, and keys replays by decision', () => {
    const base = buildView([
      { type: 'game_started', kind: 'live', configHash: 'h', players: [{ id: 'hex', kind: 'jev', model: 'jev-1' }, { id: 'pill', kind: 'llm', model: 'x/y' }], gameId: 'g', seq: 1, ts: 0 },
    ] as GameEvent[])
    const seat = (over: Partial<TableView['seats'][number]>) => ({ ...base.seats[0]!, ...over })
    const hand = (over: Partial<NonNullable<TableView['hand']>>) => ({
      handId: 'h1', seatOrder: ['hex', 'pill'], buttonIndex: 0, smallBlind: 50, bigBlind: 100, board: [], pot: 0, street: 'preflop' as const,
      toAct: null, options: null, showdown: null, awards: [], ended: false, ...over,
    })
    const out = { ...base, seats: [seat({ status: 'out' })] }
    expect(seatMoment(out, 'hex')).toMatchObject({ moment: 'eliminated', key: 'out' })
    const lost = { ...base, hand: hand({ ended: true, awards: [{ amount: 5000, winners: ['pill'], shares: { pill: 5000 } }] }), seats: [seat({ committed: BIG_LOSS_BB * 100 })] }
    expect(seatMoment(lost, 'hex').moment).toBe('lost_big')
    const decision = { handId: 'h1', playerId: 'hex', street: 'preflop' as const, optionId: 'call' as const, label: 'Call 100', winProbability: null, confidence: null, optionProbabilities: null, reasoning: null, latencyMs: 1, costUsd: 0, fallback: true, fallbackKind: 'timeout' as const, fallbackReason: 'timeout' }
    const fell = { ...base, hand: hand({}), lastDecision: decision, seats: [seat({ decisions: 3, lastAction: { street: 'preflop' as const, optionId: 'call' as const, label: 'Call 100' } })] }
    expect(seatMoment(fell, 'hex')).toMatchObject({ moment: 'fallback', jevDecided: true, key: 'h1:3:fallback' })
    const fine = { ...fell, lastDecision: { ...decision, fallback: false } }
    expect(seatMoment(fine, 'hex')).toMatchObject({ moment: 'check_call', jevDecided: true })
    // Broke when the game ended (knocked out in the last hand): eliminated, not waiting.
    const over = { ...base, status: 'ended' as const, hand: hand({ ended: true }), seats: [seat({ stack: 0, committed: 50 })] }
    expect(seatMoment(over, 'hex').moment).toBe('eliminated')
  })
})

describe('feed', () => {
  it('builds the same view as the log, keeps a capped log, and records equity just before each decision', async () => {
    const events = await mockGame(8)
    let state = reduceFeed(initialFeed(), { type: 'snapshot', channel: { id: 'c1', mode: 'live', title: 'LIVE', gameId: 'g' }, view: emptyView() }, name)
    for (const e of events) {
      if (e.type === 'decision') {
        state = reduceFeed(state, { type: 'equity', channelId: 'c1', handId: e.handId, equity: { [e.playerId]: 0.42 }, estimated: false }, name)
        state = reduceFeed(state, { type: 'event', channelId: 'c1', event: e }, name)
        expect(state.decisionEquity).toBe(0.42)
      } else state = reduceFeed(state, { type: 'event', channelId: 'c1', event: e }, name)
    }
    expect({ ...state.view, equity: null, equityEstimated: false }).toEqual(buildView(events))
    expect(state.log.length).toBeLessThanOrEqual(LOG_LIMIT)
    expect(state.log.at(-1)!.kind).toBe('end')
    // Messages for another programme are ignored; a snapshot resets everything.
    const same = reduceFeed(state, { type: 'event', channelId: 'old', event: events[1]! }, name)
    expect(same).toBe(state)
    const reset = reduceFeed(state, { type: 'snapshot', channel: { id: 'c2', mode: 'idle', title: 'x', gameId: null }, view: emptyView() }, name)
    expect(reset).toMatchObject({ log: [], decisionEquity: null, channel: { id: 'c2' } })
  })

  it('writes log lines and picks sounds', async () => {
    const events = await mockGame(3)
    let view = emptyView()
    const lines = events
      .map((e) => {
        const line = logLine(e, name, view)
        view = applyEvent(view, e)
        return line
      })
      .filter((l) => l !== null)
    expect(lines[0]).toMatchObject({ kind: 'hand', text: 'Hand 1 · blinds 25/50' })
    expect(lines.filter((l) => l.kind === 'hand').at(-1)!.text).toMatch(/^Hand \d+ · blinds [\d,]+\/[\d,]+$/)
    expect(lines.some((l) => l.kind === 'win' && /^[A-Z &]+ (wins|split) [\d,]+/.test(l.text))).toBe(true)
    for (const l of lines.filter((x) => x.kind === 'action')) expect(l.text).toMatch(/^[A-Z]+ (folds|checks|calls|bets|raises to|goes all-in)\b/)
    for (const l of lines.filter((x) => x.kind === 'street')) {
      expect(l.tag).toMatch(/^(FLOP|TURN|RIVER)$/)
      expect(l.text).toMatch(/^(([2-9JQKA]|10)[♠♥♦♣]\uFE0E ?)+$/) // just the cards: the tag says which street
    }
    for (const l of lines) expect(l.ts).toBeGreaterThan(0)
    expect(lines.filter((l) => l.kind === 'hand').map((l) => l.hand)).toEqual(lines.filter((l) => l.kind === 'hand').map((_, i) => i + 1))
    for (const l of lines.filter((x) => x.kind === 'action')) expect(['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE', 'ALL-IN']).toContain(l.tag)
    expect(lines.filter((l) => l.kind === 'win').every((l) => l.tag === 'WIN' || l.tag === 'SPLIT')).toBe(true)
    for (const l of lines) expect(l.text).not.toMatch(/ ms\b|hand-|undefined/)
    expect(soundFor('street', 'FLOP')).toBe('card')
    expect(soundFor('action', 'PILL folds')).toBe('fold')
    expect(soundFor('action', 'HEX checks')).toBeNull()
    expect(soundFor('action', 'HEX raises to 300')).toBe('chip')
    expect(fallbackNotice('auto', 'auto: too many failures')).toBe('connection lost: seat auto-played')
    expect(fallbackNotice('auto', 'auto: budget cap reached')).toBe('budget cap reached')
    expect(fallbackNotice('timeout', 'timeout')).toBe('timed out')
  })

  it('describes each decision in plain words', () => {
    const line = (label: string, extra = {}) => logLine({ type: 'decision', seq: 9, ts: 5, playerId: 'hex', label, fallback: false, fallbackKind: null, fallbackReason: null, ...extra } as never, name, emptyView())!
    const d = (label: string, extra = {}) => line(label, extra).text
    expect(['Fold', 'Check', 'Call 150', 'Call all-in 1,250', 'Bet 200', 'Raise to 1,300', 'All-in 4,800'].map((l) => line(l).tag)).toEqual(['FOLD', 'CHECK', 'CALL', 'ALL-IN', 'BET', 'RAISE', 'ALL-IN'])
    expect(d('Fold')).toBe('HEX folds')
    expect(d('Check')).toBe('HEX checks')
    expect(d('Call 150')).toBe('HEX calls 150')
    expect(d('Call all-in 1,250')).toBe('HEX calls all-in for 1,250')
    expect(d('Bet 200')).toBe('HEX bets 200')
    expect(d('Raise to 1,300')).toBe('HEX raises to 1,300')
    expect(d('All-in 4,800')).toBe('HEX goes all-in (4,800)')
    expect(d('Fold', { fallback: true, fallbackKind: 'timeout', fallbackReason: 'timeout' })).toBe('HEX folds (timed out)')
  })
})


describe('paper spreads', () => {
  it('pages through a paper two at a time, and reaches a last page that stands alone', () => {
    // Five pages: 1-2, 3-4, then 5 on its own. The last page used to be unreachable.
    let first = 1
    const seen: number[][] = []
    for (let i = 0; i < 4; i++) {
      seen.push(spread(first, 2, 5).pages)
      first = stepFrom(first, 1, 2, 5)
    }
    expect(seen).toEqual([[1, 2], [3, 4], [5], [5]])
    expect(spread(5, 2, 5)).toMatchObject({ canBack: true, canForward: false })
    expect(spread(1, 2, 5)).toMatchObject({ canBack: false, canForward: true })
    // One page at a time on a phone, from wherever the spread had got to.
    expect(spread(3, 1, 5).pages).toEqual([3])
    expect(spread(5, 1, 5)).toMatchObject({ pages: [5], canForward: false })
    // Back from the end lands on the spread before it.
    expect(spread(stepFrom(5, -1, 2, 5), 2, 5).pages).toEqual([3, 4])
  })
})

describe('which study the Research page shows', () => {
  const entry = (id: string, kind = 'llm') => ({ dir: id, report: { study: { id }, players: [{ playerId: 'a', kind }] } }) as unknown as ReportEntry
  it('tells results from pilots and rehearsals', () => {
    expect(studyKind(entry('main-2026-09').report)).toBe('study')
    expect(studyKind(entry('smoke-2026-09c').report)).toBe('pilot')
    expect(studyKind(entry('pilot-1').report)).toBe('pilot')
    expect(studyKind(entry('main-2026-09-mock').report)).toBe('rehearsal')
    expect(studyKind(entry('main', 'mock').report)).toBe('rehearsal')
  })
  it('shows the newest real study, never a pilot: a 20-hand smoke test is not a result', () => {
    expect(latestStudy([entry('smoke-2026-09c'), entry('x-mock'), entry('main-2026-09')])?.dir).toBe('main-2026-09')
    expect(latestStudy([entry('smoke-2026-09c'), entry('x-mock')])).toBeNull()
  })
})

describe('a study\'s data files', () => {
  it('serves the per-hand table and the whole event log too, and lists only the files a report has', () => {
    expect(REPORT_FILES['hands.csv']).toMatch(/^text\/csv/)
    expect(REPORT_FILES['events.jsonl']).toMatch(/json/)
    const root = mkdtempSync(join(tmpdir(), 'ab-files-'))
    mkdirSync(join(root, 's1'))
    for (const f of ['decisions.csv', 'report.json', 'notes.txt']) writeFileSync(join(root, 's1', f), 'x')
    expect(availableFiles('s1', root).sort()).toEqual(['decisions.csv', 'report.json'])
    expect(availableFiles('../s1', root)).toEqual([])
  })
})

describe('dealing', () => {
  const hand = { seatOrder: ['a', 'b', 'c', 'd'], buttonIndex: 1 }
  it('deals hole cards one at a time round the table, starting left of the button, like a dealer', () => {
    // Button is b, so c gets the first card, then d, a, b; then the second round.
    expect(['c', 'd', 'a', 'b'].map((id) => holeDelay(hand, id, 0))).toEqual([0, 1, 2, 3].map((k) => k * DEAL_STEP_MS))
    expect(holeDelay(hand, 'c', 1)).toBe(4 * DEAL_STEP_MS)
    expect(holeDelay(hand, 'b', 1)).toBe(7 * DEAL_STEP_MS)
    // A seat not in the hand (or no hand) gets no delay rather than a wrong one.
    expect(holeDelay(hand, 'z', 0)).toBe(0)
    expect(holeDelay(null, 'a', 1)).toBe(0)
  })
  it('turns the flop over left to right; the turn and river come alone', () => {
    expect([0, 1, 2, 3, 4].map(boardDelay)).toEqual([0, BOARD_STAGGER_MS, 2 * BOARD_STAGGER_MS, 0, 0])
  })
  it('knows who won once the hand is over, and not before', () => {
    const awards: Array<{ amount: number; winners: string[]; shares: Record<string, number> }> = [
      { amount: 100, winners: ['a'], shares: { a: 100 } },
      { amount: 40, winners: ['b', 'c'], shares: { b: 20, c: 20 } },
    ]
    expect(['a', 'b', 'c', 'd'].map((id) => wonHand({ ended: true, awards }, id))).toEqual([true, true, true, false])
    expect(wonHand({ ended: false, awards }, 'a')).toBe(false)
    expect(wonHand(null, 'a')).toBe(false)
  })
})
