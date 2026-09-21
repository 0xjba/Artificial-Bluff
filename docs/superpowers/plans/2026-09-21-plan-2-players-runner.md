# artificialBluff Plan 2: Players, Table Runner and Event Log

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything needed to play real games: the players (Jev via the TypeSafe SDK, LLMs via OpenRouter, rule-based bots, a free mock LLM), a table runner that plays hands with timeouts and fallbacks, a SQLite event log that records every event and decision (with cost and latency), a live-tournament driver with a budget cap, a free `pnpm demo`, and a real-API `pnpm smoke`.

**Architecture:** Two new packages on top of `@ab/engine`. `@ab/players` turns engine state into an `Observation` (identical for every player) and defines `Player.decide(obs, signal) → DecideResult` (failures are results, not throws, and carry their cost). `@ab/core` has the event types, the `EventStore` (better-sqlite3), `playHand` (one hand: ask → validate against the menu → check-or-fold fallback → apply → events) and `runTournamentGame` (live format, budget cap, interruption). Two small engine additions: seat position names and hand ids.

**Tech Stack:** Node 20+, pnpm 10 workspaces, TypeScript 5 strict, Vitest 2, `@typesafe-ai/sdk` 0.6.0 (MIT), OpenRouter chat completions via `fetch`, `better-sqlite3` 12, `tsx` for scripts.

**Spec:** `docs/superpowers/specs/2026-09-21-artificialbluff-design.md` (§3 architecture, §5 players, §7 live server behaviours, §9 errors, §10 testing). Status/todos: `docs/STATUS.md`.

**Plan series:** 1 Engine (merged) → 2 Players, runner, event log (this) → 3 Study runner and report → 4 Live server, web, mascots.

---

## Notes for the implementer

- **Fairness:** every player gets the same `Observation` (hole cards, board, positions, stacks, bets, this hand's history, computed facts: pot, to call, pot odds, effective stack in bb, SPR, and the option menu). Opponents are identified only by position, never by id or model. Jev receives it as `state` (options become its Choice criteria); LLMs receive it as JSON in the user message.
- **Failures are data:** `Player.decide` resolves with `{ok: false, error, usage}` for ordinary failures, so a failed LLM call's cost is still recorded. The runner also converts rejections and timeouts into failures.
- **Fallback:** on failure, timeout or an option id that isn't offered, the runner plays check if free, else fold, and records `fallback: true` with the reason. After 3 consecutive fallbacks a player auto check/folds for the rest of the hand (spec §9 provider outage rule).
- **Events** are the single source of truth (spec §3). The store assigns `seq`/`ts`; decisions are also denormalized into a `decisions` table for analysis. Record chip amounts (`chipsIn`, `label`), not only option ids, because merged menu ids vary by spot.
- **Never send `deck` or `config.seed` to spectators** (Plan 4); events here never contain them.
- **OpenRouter facts (checked 2026-09-21):** every response includes `usage.cost` (credits ≈ USD) plus token counts; `response_format: {type: "json_schema", ...}` with `provider.require_parameters: true` routes only to endpoints supporting it; `reasoning: {effort: "none"}` disables thinking, but models that always reason reject it, and models without a `reasoning` parameter would be filtered out by `require_parameters`, so set `disableReasoning: false` for those in the line-up.
- **TypeSafe SDK facts (0.6.0 types, saved in `docs/jev/sdk-js-0.6.0-types.d.mts.txt`):** `client.systemOne({state, questions, model}, {signal, retry})` → `{model, answers, usage: {input_tokens, output_tokens}}`; Choice answers have `choice`, `confidence`, `probabilities`; Noul answers have `noul`. The client accepts a custom `fetch`, which the tests use (no SDK mocking).
- **pnpm 10 blocks native build scripts;** root `package.json` must list `better-sqlite3` in `pnpm.onlyBuiltDependencies`.

## File map

| File | Responsibility |
|---|---|
| `packages/engine/src/positions.ts` | Seat position names (BTN/SB/BB/UTG/…/CO), blind seats |
| `packages/engine/src/{types,hand,tournament}.ts` (modify) | `handId` on HandConfig/HandResult; tournament tags and checks hand ids |
| `packages/players/src/types.ts` | Observation, Decision, Usage, DecideResult, Player |
| `packages/players/src/observation.ts` | `buildObservation(state, menu)` |
| `packages/players/src/bots.ts` | RandomBot, CallingStation, TagBot, shared rule helpers |
| `packages/players/src/mock.ts` | MockLlm: free deterministic LLM stand-in with failure injection |
| `packages/players/src/llm/openrouter.ts` | Minimal OpenRouter chat-completions client |
| `packages/players/src/llm/prompt.ts` | System prompt, user message, JSON schema |
| `packages/players/src/llm/parse.ts` | Parse + validate an LLM reply |
| `packages/players/src/llm/llm-player.ts` | LlmPlayer (one retry with the specific error) |
| `packages/players/src/jev/jev-player.ts` | JevPlayer (Choice over options + win Noul) |
| `packages/players/src/factory.ts` | `createPlayers(lineup, env)` |
| `packages/core/src/events.ts` | Event types, EventSink |
| `packages/core/src/store.ts` | EventStore (SQLite): games, events, decisions, cost |
| `packages/core/src/runner.ts` | `playHand` |
| `packages/core/src/game.ts` | `runTournamentGame` |
| `packages/core/scripts/{demo,smoke}.ts` | `pnpm demo` (free), `pnpm smoke` (real APIs, capped) |
| `lineups/research.example.json`, `lineups/live.example.json`, `.env.example` | Research line-up (frontier models), everyday live line-up (cheaper), key names |

---

### Task 1: Seat position names (engine)

**Files:**
- Create: `packages/engine/src/positions.ts`
- Modify: `packages/engine/src/index.ts` (add export)
- Test: `packages/engine/test/positions.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/positions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createHand } from '../src/hand'
import { blindSeats, positions } from '../src/positions'

describe('positions', () => {
  it('names a 5-handed table', () => {
    expect(positions(5, 0)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'CO'])
    expect(positions(5, 3)).toEqual(['BB', 'UTG', 'CO', 'BTN', 'SB'])
  })

  it('names heads-up, 3-handed and full tables', () => {
    expect(positions(2, 0)).toEqual(['BTN', 'BB'])
    expect(positions(2, 1)).toEqual(['BB', 'BTN'])
    expect(positions(3, 0)).toEqual(['BTN', 'SB', 'BB'])
    expect(positions(6, 0)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'])
    expect(positions(10, 0)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP', 'LJ', 'HJ', 'CO'])
  })

  it('rejects out-of-range player counts and button indices', () => {
    expect(() => positions(1, 0)).toThrow(/2 to 10 players/)
    expect(() => positions(11, 0)).toThrow(/2 to 10 players/)
    expect(() => positions(5, 5)).toThrow(/buttonIndex/)
    expect(() => blindSeats(5, -1)).toThrow(/buttonIndex/)
  })

  it('agrees with the seats the engine actually posts blinds from', () => {
    for (let n = 2; n <= 10; n++) {
      for (let button = 0; button < n; button++) {
        const state = createHand({
          seats: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, stack: 1000 })),
          buttonIndex: button,
          smallBlind: 50,
          bigBlind: 100,
          seed: 1,
        })
        const sb = state.history.find((h) => h.kind === 'post_sb')!.seatIndex
        const bb = state.history.find((h) => h.kind === 'post_bb')!.seatIndex
        expect(blindSeats(n, button)).toEqual({ sb, bb })
        const names = positions(n, button)
        expect(new Set(names).size).toBe(n)
        expect(names[bb]).toBe('BB')
      }
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/engine exec vitest run test/positions.test.ts`
Expected: FAIL, cannot resolve `../src/positions`.

- [ ] **Step 3: Implement**

`packages/engine/src/positions.ts`:

```ts
export type Position = 'BTN' | 'SB' | 'BB' | 'UTG' | 'UTG+1' | 'UTG+2' | 'MP' | 'LJ' | 'HJ' | 'CO'

export const MAX_POSITIONED_PLAYERS = 10

/**
 * Names for the seats between the big blind and the button, by how many there are.
 * Deliberate convention: seats fill in from the button side (CO, HJ, LJ) and the earliest seats
 * are UTG, UTG+1, UTG+2, so every seat has a distinct, unambiguous label at every table size
 * (6-max and 10-max match common solver naming; some sites say EP/MP for 7-9 handed).
 */
const MIDDLE: Position[][] = [
  [],
  ['UTG'],
  ['UTG', 'CO'],
  ['UTG', 'HJ', 'CO'],
  ['UTG', 'LJ', 'HJ', 'CO'],
  ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO'],
  ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO'],
  ['UTG', 'UTG+1', 'UTG+2', 'MP', 'LJ', 'HJ', 'CO'],
]

/** Seat indices of the blinds. Heads-up the button posts the small blind. */
export function blindSeats(playerCount: number, buttonIndex: number): { sb: number; bb: number } {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > MAX_POSITIONED_PLAYERS) {
    throw new Error(`positions support 2 to ${MAX_POSITIONED_PLAYERS} players`)
  }
  if (!Number.isInteger(buttonIndex) || buttonIndex < 0 || buttonIndex >= playerCount) {
    throw new Error('buttonIndex out of range')
  }
  if (playerCount === 2) return { sb: buttonIndex, bb: (buttonIndex + 1) % 2 }
  return { sb: (buttonIndex + 1) % playerCount, bb: (buttonIndex + 2) % playerCount }
}

/**
 * Position name for every seat index. Heads-up the button is labelled 'BTN' (it also posts
 * the small blind) and the other seat 'BB'.
 */
export function positions(playerCount: number, buttonIndex: number): Position[] {
  const out = new Array<Position>(playerCount)
  const { sb, bb } = blindSeats(playerCount, buttonIndex)
  out[buttonIndex] = 'BTN'
  if (playerCount === 2) {
    out[bb] = 'BB'
    return out
  }
  out[sb] = 'SB'
  out[bb] = 'BB'
  MIDDLE[playerCount - 3]!.forEach((name, k) => {
    out[(bb + 1 + k) % playerCount] = name
  })
  return out
}
```

Append to `packages/engine/src/index.ts`:
```ts
export * from './positions'
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/engine exec vitest run && pnpm --filter @ab/engine typecheck`
Expected: PASS (103 tests); typecheck clean.

- [ ] **Step 5: Commit**


```bash
git add packages/engine/src/positions.ts packages/engine/src/index.ts packages/engine/test/positions.test.ts
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(engine): seat position names" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```


---

### Task 2: Hand ids from config to result (engine)

Lets the tournament reject a result from a different hand (Plan 1 review residual).

**Files:**
- Modify: `packages/engine/src/types.ts`, `packages/engine/src/hand.ts`, `packages/engine/src/tournament.ts`
- Test: `packages/engine/test/tournament.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/engine/test/tournament.test.ts`: add `tournamentHandId,` to the import list from `../src/tournament`; change the `result` helper's return line to include `handId: null`, and add a `rec` helper after it that records a synthetic result as the current hand:
```ts
  return { handId: null, showdown: false, awards: [], hands: {}, board: [], stacks, net: {} }
}

/** Records a synthetic result as the tournament's current hand. */
const rec = (t: TournamentState, r: HandResult) => recordHand(t, { ...r, handId: tournamentHandId(t.handNumber) })
```
(the closing `}` shown is the helper's existing one). Replace every existing `recordHand(t, result(` with `rec(t, result(`, and `recordHand(a, result(` with `rec(a, result(`, since tournaments now require the current hand id. Then add this test immediately before `it('allows at most 10 players', ...)`:
```ts
  it('tags hands with an id and rejects a result from a different hand', () => {
    let t = createTournament(['a', 'b'], liveTurboConfig('s'))
    expect(nextHandConfig(t).handId).toBe('hand-0')
    const first = { ...result({ a: 2000, b: 4000 }), handId: 'hand-0' }
    t = recordHand(t, first)
    expect(nextHandConfig(t).handId).toBe('hand-1')
    expect(() => recordHand(t, first)).toThrow(/not for the current hand/)
    expect(() => recordHand(t, { ...first, handId: null })).toThrow(/not for the current hand/)
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/engine exec vitest run test/tournament.test.ts`
Expected: FAIL (typecheck-free Vitest runs; the new test fails because `handId` is undefined).

- [ ] **Step 3: Implement**

In `packages/engine/src/types.ts`, add to `HandConfig` after the `deck?` field:
```ts
  /** Optional identifier echoed into `HandResult.handId`, so results can be matched to hands. */
  handId?: string
```
and add as the first field of `HandResult`:
```ts
  /** `HandConfig.handId`, or null when the hand had none (standalone hands only; tournaments require it). */
  handId: string | null
```

In `packages/engine/src/hand.ts`, replace the line building `result` in `finishHand` with:
```ts
  const result: HandResult = {
    handId: state.config.handId ?? null,
    showdown,
    awards,
    hands,
    board: [...state.board],
    stacks,
    net,
  }
```

In `packages/engine/src/tournament.ts`, add before `nextHandConfig`:
```ts
/** Hand id used by `nextHandConfig` and checked by `recordHand`. */
export function tournamentHandId(handNumber: number): string {
  return `hand-${handNumber}`
}
```
add `handId: tournamentHandId(t.handNumber),` as the last property of the object returned by `nextHandConfig` (after `seed`), and at the start of `recordHand`, right after the `if (prev.complete) throw ...` line, add:
```ts
  // Every tournament result must come from the hand nextHandConfig dealt (its id), never a stale one.
  const expectedId = tournamentHandId(prev.handNumber)
  if (result.handId !== expectedId) {
    throw new Error(`hand result ${result.handId} is not for the current hand ${expectedId}`)
  }
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/engine exec vitest run && pnpm --filter @ab/engine typecheck`
Expected: PASS (104 tests); typecheck clean.

- [ ] **Step 5: Commit**


```bash
git add packages/engine/src/types.ts packages/engine/src/hand.ts packages/engine/src/tournament.ts packages/engine/test/tournament.test.ts
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(engine): hand ids from config to result; tournament rejects stale results" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```


---

### Task 3: Players package, types and observations

**Files:**
- Create: `packages/players/package.json`, `packages/players/tsconfig.json`
- Create: `packages/players/src/types.ts`, `packages/players/src/observation.ts`
- Test: `packages/players/test/observation.test.ts`

- [ ] **Step 1: Create the package**

`packages/players/package.json`:

```json
{
  "name": "@ab/players",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ab/engine": "workspace:*",
    "@typesafe-ai/sdk": "0.6.0"
  }
}
```

`packages/players/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Run: `pnpm install` (expect it to link `@ab/engine` and fetch `@typesafe-ai/sdk`).

- [ ] **Step 2: Create the types**

`packages/players/src/types.ts`:

```ts
import type { Card, OptionId, Position, Street } from '@ab/engine'

export interface SeatView {
  position: Position
  /** Chips behind (not yet committed). */
  stack: number
  status: 'active' | 'folded' | 'all_in'
  /** Chips put in on the current street. */
  bet: number
  /** True for the player who is to act. Opponents are identified only by position. */
  you: boolean
}

/** Arithmetic computed by code so no player has to do it. */
export interface Facts {
  smallBlind: number
  bigBlind: number
  /** All chips in the middle, including this street's bets. */
  pot: number
  /** Chips needed to call, capped at your stack (a call for less is all-in). */
  toCall: number
  /**
   * toCall / (winnable pot + toCall) as a percentage, one decimal; 0 when nothing to call.
   * The winnable pot counts each player's chips only up to what you can match.
   */
  potOddsPct: number
  /** Effective stack at the start of this street (smaller of yours and the largest live opponent's), in big blinds, one decimal. */
  effectiveStackBb: number
  /** Effective stack / pot at the start of this street, one decimal; null preflop. Fixed for the whole street. */
  spr: number | null
}

export interface ObservedOption {
  id: OptionId
  label: string
}

/** Everything a player sees at a decision. Identical for every kind of player. */
export interface Observation {
  street: Street
  position: Position
  hole: Card[]
  board: Card[]
  seats: SeatView[]
  /** This hand's actions so far, e.g. "preflop: UTG raises to 300". */
  history: string[]
  facts: Facts
  options: ObservedOption[]
}

export interface Decision {
  optionId: OptionId
  /** Stated probability of winning this hand, 0-1, or null if the player gives none. */
  winProbability: number | null
  /** Confidence that the chosen action is best, 0-1, or null. */
  confidence: number | null
  /** Probability per offered option (Jev), or null. */
  optionProbabilities: Partial<Record<OptionId, number>> | null
  /** Short free-text reasoning (LLMs), or null. */
  reasoning: string | null
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  costUsd: number
  /** Extra attempts made after the first (e.g. an invalid-output retry). */
  retries: number
}

export const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, retries: 0 }

/** A failed decision still reports what it cost: failed calls are billed too. */
export type DecideResult =
  | { ok: true; decision: Decision; usage: Usage; model: string }
  | { ok: false; error: string; usage: Usage; model: string }

export type PlayerKind = 'jev' | 'llm' | 'bot' | 'mock'

export interface Player {
  readonly id: string
  readonly kind: PlayerKind
  /** Model id (or bot name) as configured. */
  readonly model: string
  /**
   * Must resolve for ordinary failures (returning `ok: false` with any usage incurred). Once `signal`
   * aborts (timeout), it should stop work and may reject: the runner has already recorded a timeout.
   */
  decide(obs: Observation, signal: AbortSignal): Promise<DecideResult>
}
```

- [ ] **Step 3: Write the failing test**

`packages/players/test/observation.test.ts`:

```ts
import { applyAction, buildMenu, createHand, deriveSeed, mulberry32, type HandState } from '@ab/engine'
import { describe, expect, it } from 'vitest'
import { buildObservation } from '../src/observation'

function start(stacks: number[]): HandState {
  return createHand({
    seats: stacks.map((stack, i) => ({ id: `p${i}`, stack })),
    buttonIndex: 0,
    smallBlind: 50,
    bigBlind: 100,
    seed: 5,
    handId: 'hand-7',
  })
}

describe('buildObservation', () => {
  it('describes the spot for the player to act, identifying opponents only by position', () => {
    let s = start([10_000, 10_000, 10_000, 10_000, 10_000])
    s = applyAction(s, { type: 'raise', to: 300 }) // UTG (p3) opens
    const obs = buildObservation(s)
    expect('handId' in obs).toBe(false) // the hand counter is not shown to players
    expect(obs.position).toBe('CO')
    expect(obs.hole).toEqual(s.seats[4]!.hole)
    expect(obs.board).toEqual([])
    expect(obs.seats.map((x) => [x.position, x.stack, x.bet, x.status, x.you])).toEqual([
      ['BTN', 10_000, 0, 'active', false],
      ['SB', 9_950, 50, 'active', false],
      ['BB', 9_900, 100, 'active', false],
      ['UTG', 9_700, 300, 'active', false],
      ['CO', 10_000, 0, 'active', true],
    ])
    expect(obs.history).toEqual([
      'preflop: SB posts small blind 50',
      'preflop: BB posts big blind 100',
      'preflop: UTG raises to 300',
    ])
    expect(obs.facts).toEqual({
      smallBlind: 50,
      bigBlind: 100,
      pot: 450,
      toCall: 300,
      potOddsPct: 40,
      effectiveStackBb: 100,
      spr: null,
    })
    expect(obs.options[0]).toEqual({ id: 'fold', label: 'Fold' })
    expect(JSON.stringify(obs)).not.toContain('p3') // no player ids leak
  })

  it('marks all-in and folded seats and lists the flop action', () => {
    // Button p0, SB p1, BB p2, UTG p3 (500 chips) shoves.
    let s = start([10_000, 10_000, 10_000, 500])
    s = applyAction(s, { type: 'raise', to: 500 })
    let obs = buildObservation(s)
    expect(obs.position).toBe('BTN')
    expect(obs.seats[3]!.status).toBe('all_in')
    expect(obs.history.at(-1)).toBe('preflop: UTG raises to 500 (all-in)')
    s = applyAction(s, { type: 'call' }) // BTN calls
    s = applyAction(s, { type: 'fold' }) // SB folds
    s = applyAction(s, { type: 'call' }) // BB calls
    obs = buildObservation(s)
    expect(obs.street).toBe('flop')
    expect(obs.position).toBe('BB')
    expect(obs.board).toHaveLength(3)
    expect(obs.seats[1]!.status).toBe('folded')
    // Pot 500 x 3 + 50 = 1,550; effective = min(9,500, 9,500) = 9,500 -> SPR 6.1.
    expect(obs.facts.pot).toBe(1550)
    expect(obs.facts.spr).toBe(6.1)
    s = applyAction(s, { type: 'check' })
    expect(buildObservation(s).history.at(-1)).toBe('flop: BB checks')
  })

  it('caps the amount to call at the stack and prices pot odds on the winnable pot', () => {
    // BTN has 1,000; UTG raises to 10,000. BTN can only call 1,000 all-in.
    let s = start([1000, 10_000, 10_000, 10_000])
    s = applyAction(s, { type: 'raise', to: 10_000 })
    const obs = buildObservation(s)
    expect(obs.position).toBe('BTN')
    expect(obs.facts.toCall).toBe(1000)
    expect(obs.options.find((o) => o.id === 'call')!.label).toBe('Call all-in 1,000')
    // Winnable pot: SB 50 + BB 100 + UTG's first 1,000 = 1,150. Odds 1,000 / 2,150.
    expect(obs.facts.potOddsPct).toBe(46.5)
  })

  it('describes a blind posted all-in', () => {
    const s = start([10_000, 30, 10_000])
    expect(buildObservation(s).history[0]).toBe('preflop: SB posts small blind 30 (all-in)')
  })

  it('keeps SPR fixed for the whole street', () => {
    let s = start([10_000, 10_000, 10_000])
    s = applyAction(s, { type: 'call' })
    s = applyAction(s, { type: 'call' })
    s = applyAction(s, { type: 'check' }) // flop: pot 300, SB first
    const first = buildObservation(s).facts.spr
    s = applyAction(s, { type: 'raise', to: 200 }) // SB bets 200
    expect(buildObservation(s).facts.spr).toBe(first)
    expect(first).toBe(33) // 9,900 / 300
  })

  it('never reveals opponents\' hole cards or undealt cards', () => {
    for (let h = 0; h < 500; h++) {
      const rand = mulberry32(deriveSeed('leak', h))
      let s = start([10_000, 10_000, 10_000, 10_000, 10_000])
      while (!s.complete) {
        const obs = buildObservation(s)
        const text = JSON.stringify(obs)
        const me = s.seats[s.toAct!]!
        const hidden = [...s.seats.filter((x) => x !== me).flatMap((x) => x.hole), ...s.deck]
        for (const card of hidden) expect(text).not.toContain(`"${card}"`)
        const menu = buildMenu(s)
        s = applyAction(s, menu[Math.floor(rand() * menu.length)]!.action)
      }
    }
  })

  it('throws when nobody is to act', () => {
    const s = applyAction(start([1000, 1000]), { type: 'fold' })
    expect(() => buildObservation(s)).toThrow(/nobody/)
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @ab/players exec vitest run`
Expected: FAIL, cannot resolve `../src/observation`.

- [ ] **Step 5: Implement**

`packages/players/src/observation.ts`:

```ts
import { buildMenu, legalActions, positions, potSize, type HandState, type MenuOption } from '@ab/engine'
import type { Observation, SeatView } from './types'

const round1 = (x: number) => Math.round(x * 10) / 10

const VERB: Record<string, string> = {
  post_sb: 'posts small blind',
  post_bb: 'posts big blind',
  fold: 'folds',
  check: 'checks',
  call: 'calls',
  bet: 'bets',
  raise: 'raises to',
}

/** The observation for the player to act. `menu` defaults to the engine's shared menu. */
export function buildObservation(state: HandState, menu: MenuOption[] = buildMenu(state)): Observation {
  if (state.toAct === null) throw new Error('buildObservation: nobody is to act')
  const me = state.seats[state.toAct]!
  const names = positions(state.seats.length, state.config.buttonIndex)
  const { smallBlind, bigBlind } = state.config

  const seats: SeatView[] = state.seats.map((s, i) => ({
    position: names[i]!,
    stack: s.stack,
    status: s.folded ? 'folded' : s.allIn ? 'all_in' : 'active',
    bet: s.streetCommitted,
    you: i === state.toAct,
  }))

  const history = state.history.map((h) => {
    const who = names[h.seatIndex]!
    const verb = VERB[h.kind]!
    const amount = h.kind === 'fold' || h.kind === 'check' ? '' : ` ${h.kind === 'call' || h.kind.startsWith('post') ? h.amount : h.to}`
    return `${h.street}: ${who} ${verb}${amount}${h.allIn ? ' (all-in)' : ''}`
  })

  const pot = potSize(state)
  const toCall = legalActions(state).callAmount
  // Only chips up to what this player can match are winnable; any excess goes back to its owner.
  const reach = me.handCommitted + toCall
  const winnablePot = state.seats.reduce((sum, s) => sum + Math.min(s.handCommitted, reach), 0)
  // Stacks and pot as they were when this street began, so SPR and effective stack don't drift mid-street.
  const opponents = state.seats.filter((s) => s !== me && !s.folded)
  const biggestOpponent = Math.max(0, ...opponents.map((s) => s.stack + s.streetCommitted))
  const effective = Math.min(me.stack + me.streetCommitted, biggestOpponent)
  const potAtStreetStart = pot - state.seats.reduce((sum, s) => sum + s.streetCommitted, 0)

  return {
    street: state.street,
    position: names[state.toAct]!,
    hole: [...me.hole],
    board: [...state.board],
    seats,
    history,
    facts: {
      smallBlind,
      bigBlind,
      pot,
      toCall,
      potOddsPct: toCall > 0 ? round1((100 * toCall) / (winnablePot + toCall)) : 0,
      effectiveStackBb: round1(effective / bigBlind),
      spr: state.street === 'preflop' ? null : round1(effective / Math.max(1, potAtStreetStart)),
    },
    options: menu.map((o) => ({ id: o.id, label: o.label })),
  }
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @ab/players exec vitest run && pnpm --filter @ab/players typecheck`
Expected: PASS (7 tests); typecheck clean.

- [ ] **Step 7: Commit**


```bash
git add packages/players/package.json packages/players/tsconfig.json packages/players/src/types.ts packages/players/src/observation.ts packages/players/test/observation.test.ts pnpm-lock.yaml
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(players): player types and fair observations" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```


---

### Task 4: Bots and the mock LLM

**Files:**
- Create: `packages/players/src/bots.ts`, `packages/players/src/mock.ts`
- Test: `packages/players/test/bots.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/players/test/bots.test.ts`:

```ts
import { applyAction, buildMenu, createHand, fullDeck, type Card, type HandState } from '@ab/engine'
import { describe, expect, it } from 'vitest'
import { CallingStation, preflopStrength, RandomBot, TagBot } from '../src/bots'
import { MockLlm } from '../src/mock'
import { buildObservation } from '../src/observation'
import type { Player } from '../src/types'

const signal = new AbortController().signal

async function playOut(players: Player[], seed: number): Promise<HandState> {
  let s = createHand({
    seats: players.map((p) => ({ id: p.id, stack: 10_000 })),
    buttonIndex: 0,
    smallBlind: 50,
    bigBlind: 100,
    seed,
  })
  while (!s.complete) {
    const menu = buildMenu(s)
    const player = players[s.toAct!]!
    const res = await player.decide(buildObservation(s, menu), signal)
    if (!res.ok) throw new Error(res.error)
    const option = menu.find((o) => o.id === res.decision.optionId)
    if (!option) throw new Error(`${player.id} chose ${res.decision.optionId}`)
    s = applyAction(s, option.action)
  }
  return s
}

describe('bots', () => {
  it('only ever choose offered options, over many hands', async () => {
    for (let seed = 0; seed < 300; seed++) {
      const s = await playOut([new RandomBot('r', seed), new CallingStation('c'), new TagBot('t'), new MockLlm('m')], seed)
      expect(s.complete).toBe(true)
    }
  })

  it('rank preflop hands sensibly', () => {
    expect(preflopStrength(['As', 'Ad'])).toBe(1)
    const order = [['As', 'Ad'], ['Ks', 'Kd'], ['As', 'Ks'], ['As', 'Kd'], ['2s', '2d'], ['7c', '2d']] as const
    const scores = order.map((h) => preflopStrength([...h]))
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThan(scores[i - 1]!)
    expect(preflopStrength(['As', 'Ks'])).toBeGreaterThan(preflopStrength(['7c', '2d']))
    expect(preflopStrength(['7c', '2d'])).toBeLessThan(0.3)
  })

  it('TAG shoves a premium hand when all-in is the only raise left', async () => {
    // BB has 450 (4.5 bb) with aces and faces an open to 300: a full raise (to 500) is more than
    // it has, so the menu offers only fold, call and all-in.
    // Deal order from left of the button: SB, BB, UTG, BTN, twice.
    const top: Card[] = ['Kc', 'As', '2d', '7h', 'Kd', 'Ad', '3d', '8h']
    let s = createHand({
      seats: [{ id: 'btn', stack: 10_000 }, { id: 'sb', stack: 10_000 }, { id: 'bb', stack: 450 }, { id: 'utg', stack: 10_000 }],
      buttonIndex: 0,
      smallBlind: 50,
      bigBlind: 100,
      seed: 1,
      deck: [...top, ...fullDeck().filter((c) => !top.includes(c))],
    })
    s = applyAction(s, { type: 'raise', to: 300 }) // UTG opens
    s = applyAction(s, { type: 'fold' }) // BTN
    s = applyAction(s, { type: 'fold' }) // SB
    const obs = buildObservation(s)
    expect(obs.hole).toEqual(['As', 'Ad'])
    expect(obs.options.map((o) => o.id)).toEqual(['fold', 'call', 'all_in'])
    const res = await new TagBot('bb').decide(obs, signal)
    expect(res.ok && res.decision.optionId).toBe('all_in')
  })

  it('calling station never folds or raises', async () => {
    const station = new CallingStation('c')
    let s = createHand({ seats: [{ id: 'x', stack: 1000 }, { id: 'c', stack: 1000 }], buttonIndex: 0, smallBlind: 50, bigBlind: 100, seed: 1 })
    s = applyAction(s, { type: 'raise', to: 300 })
    const res = await station.decide(buildObservation(s), signal)
    expect(res.ok && res.decision.optionId).toBe('call')
  })
})

describe('MockLlm', () => {
  const obsFor = () =>
    buildObservation(createHand({ seats: [{ id: 'a', stack: 1000 }, { id: 'b', stack: 1000 }], buttonIndex: 0, smallBlind: 50, bigBlind: 100, seed: 2 }))

  it('reports fake usage and reasoning', async () => {
    const res = await new MockLlm('m', 'mock/llm', { inputPricePerMTok: 2 }).decide(obsFor(), signal)
    expect(res.ok).toBe(true)
    expect(res.usage.inputTokens).toBeGreaterThan(50)
    expect(res.usage.costUsd).toBeCloseTo((res.usage.inputTokens * 2) / 1e6)
    expect(res.ok && res.decision.reasoning).toMatch(/^mock:/)
  })

  it('injects failures and invalid options on schedule', async () => {
    const m = new MockLlm('m', 'mock/llm', { failEvery: 2, invalidEvery: 3 })
    const results = []
    for (let i = 0; i < 3; i++) results.push(await m.decide(obsFor(), signal))
    expect(results[0]!.ok).toBe(true)
    expect(results[1]!.ok).toBe(false)
    expect(results[2]!.ok && results[2]!.decision.optionId).toBe('not_an_option')
  })

  it('rejects immediately if already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(new MockLlm('m').decide(obsFor(), ac.signal)).rejects.toThrow(/aborted/)
  })

  it('stops when aborted', async () => {
    const ac = new AbortController()
    const pending = new MockLlm('m', 'mock/llm', { latencyMs: 1000 }).decide(obsFor(), ac.signal)
    ac.abort()
    await expect(pending).rejects.toThrow(/aborted/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/players exec vitest run test/bots.test.ts`
Expected: FAIL, cannot resolve `../src/bots`.

- [ ] **Step 3: Implement**

`packages/players/src/bots.ts`:

```ts
import { evaluateHand, mulberry32, rankValue, type OptionId } from '@ab/engine'
import { NO_USAGE, type DecideResult, type Decision, type Observation, type Player } from './types'

function decision(optionId: OptionId, extra: Partial<Decision> = {}): Decision {
  return { optionId, winProbability: null, confidence: null, optionProbabilities: null, reasoning: null, ...extra }
}

function has(obs: Observation, id: OptionId): boolean {
  return obs.options.some((o) => o.id === id)
}

/** Check if free, otherwise call if possible, otherwise fold. */
export function passiveChoice(obs: Observation): OptionId {
  if (has(obs, 'check')) return 'check'
  if (has(obs, 'call')) return 'call'
  return 'fold'
}

/** Check if free, otherwise fold. The runner's timeout/failure default. */
export function checkOrFold(obs: Observation): OptionId {
  return has(obs, 'check') ? 'check' : 'fold'
}

/** 0-1 preflop strength from a simple score: pairs, high cards, suitedness, connectedness. */
export function preflopStrength(hole: Observation['hole']): number {
  const [a, b] = hole.map(rankValue).sort((x, y) => y - x) as [number, number]
  const suited = hole[0]![1] === hole[1]![1]
  let score = a * 1.2 + b * 0.8
  if (a === b) score += 12 + a
  if (suited) score += 3
  const gap = a - b
  if (gap === 1) score += 2
  else if (gap === 2) score += 1
  else if (gap >= 4) score -= gap - 3
  // AA scores 48, the maximum possible, so it alone maps to 1.
  return Math.max(0, Math.min(1, score / 48))
}

/** Preferred raise sizes, then all-in when a short stack has no other raise. */
const RAISES: OptionId[] = ['open_3bb', 'reraise_2_5x', 'pot_75', 'pot_50', 'min_raise', 'all_in']

/** Rule-based tight-aggressive choice used by TagBot and MockLlm. */
export function tagChoice(obs: Observation): { optionId: OptionId; winProbability: number } {
  const bb = obs.facts.bigBlind
  const raise = RAISES.find((id) => has(obs, id))
  if (obs.street === 'preflop') {
    const strength = preflopStrength(obs.hole)
    if (strength >= 0.75 && raise) return { optionId: raise, winProbability: strength * 0.8 }
    if (strength >= 0.5 && obs.facts.toCall <= 3 * bb) return { optionId: passiveChoice(obs), winProbability: strength * 0.6 }
    return { optionId: checkOrFold(obs), winProbability: strength * 0.4 }
  }
  const value = evaluateHand([...obs.hole, ...obs.board])
  const strong = ['straight_flush', 'four_of_a_kind', 'full_house', 'flush', 'straight', 'three_of_a_kind', 'two_pair']
  if (strong.includes(value.category) && raise) return { optionId: raise, winProbability: 0.8 }
  if (value.category === 'one_pair' && obs.facts.potOddsPct <= 30) return { optionId: passiveChoice(obs), winProbability: 0.5 }
  return { optionId: checkOrFold(obs), winProbability: 0.2 }
}

abstract class BotBase implements Player {
  readonly kind = 'bot' as const
  constructor(
    readonly id: string,
    readonly model: string,
  ) {}
  protected abstract choose(obs: Observation): Decision
  async decide(obs: Observation, _signal?: AbortSignal): Promise<DecideResult> {
    return { ok: true, decision: this.choose(obs), usage: NO_USAGE, model: this.model }
  }
}

/** Picks uniformly among the offered options (seeded). */
export class RandomBot extends BotBase {
  private readonly rand: () => number
  constructor(id: string, seed: number) {
    super(id, 'bot/random')
    this.rand = mulberry32(seed)
  }
  protected choose(obs: Observation): Decision {
    return decision(obs.options[Math.floor(this.rand() * obs.options.length)]!.id)
  }
}

/** Never folds or raises: checks or calls. */
export class CallingStation extends BotBase {
  constructor(id: string) {
    super(id, 'bot/calling-station')
  }
  protected choose(obs: Observation): Decision {
    return decision(passiveChoice(obs))
  }
}

/** Simple tight-aggressive rules. Also states a rough win probability. */
export class TagBot extends BotBase {
  constructor(id: string) {
    super(id, 'bot/tag')
  }
  protected choose(obs: Observation): Decision {
    const { optionId, winProbability } = tagChoice(obs)
    return decision(optionId, { winProbability })
  }
}
```

`packages/players/src/mock.ts`:

```ts
import { tagChoice } from './bots'
import type { DecideResult, Observation, Player } from './types'

export interface MockLlmOptions {
  /** Pretend price per 1M input tokens, for cost-tracking tests. */
  inputPricePerMTok?: number
  /** Resolve after this many ms (respecting abort). */
  latencyMs?: number
  /** Return an ordinary failure on every Nth decision (1-based). */
  failEvery?: number
  /** Return an option id that isn't offered on every Nth decision (1-based). */
  invalidEvery?: number
}

/**
 * Free, deterministic stand-in for an LLM: TAG rules, fake reasoning, fake token usage.
 * Its win probabilities and confidence are crude rule-bucket constants, not estimates:
 * never use mock games for calibration analysis.
 */
export class MockLlm implements Player {
  readonly kind = 'mock' as const
  private calls = 0
  constructor(
    readonly id: string,
    readonly model = 'mock/llm',
    private readonly options: MockLlmOptions = {},
  ) {}

  async decide(obs: Observation, signal: AbortSignal): Promise<DecideResult> {
    if (signal.aborted) throw new Error('aborted')
    this.calls++
    const inputTokens = Math.ceil(JSON.stringify(obs).length / 4)
    const usage = {
      inputTokens,
      outputTokens: 40,
      costUsd: (inputTokens * (this.options.inputPricePerMTok ?? 1)) / 1_000_000,
      retries: 0,
    }
    if (this.options.latencyMs) await delay(this.options.latencyMs, signal)
    if (this.options.failEvery && this.calls % this.options.failEvery === 0) {
      return { ok: false, error: 'mock failure', usage, model: this.model }
    }
    const { optionId, winProbability } = tagChoice(obs)
    const invalid = this.options.invalidEvery && this.calls % this.options.invalidEvery === 0
    return {
      ok: true,
      decision: {
        optionId: invalid ? ('not_an_option' as never) : optionId,
        winProbability,
        confidence: 0.6,
        optionProbabilities: null,
        reasoning: `mock: ${optionId} on the ${obs.street}`,
      },
      usage,
      model: this.model,
    }
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'))
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    })
  })
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/players exec vitest run && pnpm --filter @ab/players typecheck`
Expected: PASS (15 tests); typecheck clean.

- [ ] **Step 5: Commit**


```bash
git add packages/players/src/bots.ts packages/players/src/mock.ts packages/players/test/bots.test.ts
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(players): random, calling-station and TAG bots; mock LLM" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```


---

### Task 5: LLM player via OpenRouter

**Files:**
- Create: `packages/players/src/llm/openrouter.ts`, `packages/players/src/llm/prompt.ts`, `packages/players/src/llm/parse.ts`, `packages/players/src/llm/llm-player.ts`
- Test: `packages/players/test/llm.test.ts`

- [ ] **Step 1: Write the failing test** (a fake `fetch`; no network, no cost)

`packages/players/test/llm.test.ts`:

```ts
import { createHand } from '@ab/engine'
import { describe, expect, it } from 'vitest'
import { LlmPlayer } from '../src/llm/llm-player'
import { OpenRouterError, chatCompletion } from '../src/llm/openrouter'
import { parseDecision } from '../src/llm/parse'
import { SYSTEM_PROMPT, responseFormat } from '../src/llm/prompt'
import { buildObservation } from '../src/observation'

const obs = buildObservation(
  createHand({ seats: [{ id: 'a', stack: 1000 }, { id: 'b', stack: 1000 }], buttonIndex: 0, smallBlind: 50, bigBlind: 100, seed: 2 }),
)
const signal = new AbortController().signal

/** A fake fetch that returns queued chat replies and records requests. */
function fakeFetch(replies: Array<{ status?: number; content?: string; cost?: number; body?: string }>) {
  const requests: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = []
  const fn = async (url: string, init?: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init!.body)), headers: init!.headers as Record<string, string> })
    const r = replies.shift()!
    const body =
      r.body ??
      JSON.stringify({
        model: 'vendor/model-2026',
        choices: [{ message: { content: r.content } }],
        usage: { prompt_tokens: 400, completion_tokens: 50, cost: r.cost ?? 0.001 },
      })
    return new Response(body, { status: r.status ?? 200 })
  }
  return { fn, requests }
}

const valid = JSON.stringify({ action: 'call', win_probability: 0.55, confidence: 0.7, reasoning: 'Decent hand, cheap price.' })

describe('parseDecision', () => {
  it('accepts a valid reply, including one wrapped in a code fence', () => {
    const r = parseDecision('```json\n' + valid + '\n```', obs)
    expect(r).toEqual({
      ok: true,
      decision: { optionId: 'call', winProbability: 0.55, confidence: 0.7, optionProbabilities: null, reasoning: 'Decent hand, cheap price.' },
    })
  })

  it('rejects unknown options, bad JSON and out-of-range probabilities with a specific error', () => {
    expect(parseDecision('nope', obs)).toEqual({ ok: false, error: 'reply was not valid JSON' })
    expect(parseDecision('{"action":"raise","win_probability":0.5,"confidence":0.5}', obs)).toMatchObject({ ok: false, error: expect.stringMatching(/must be one of: fold, call/) })
    expect(parseDecision('{"action":"call","win_probability":1.5e3,"confidence":0.5}', obs)).toMatchObject({ ok: false, error: expect.stringMatching(/between 0 and 1/) })
  })

  it('scales percentages and truncates long reasoning', () => {
    const r = parseDecision(JSON.stringify({ action: 'fold', win_probability: 70, confidence: 0.2, reasoning: 'x'.repeat(300) }), obs)
    expect(r.ok && r.decision.winProbability).toBe(0.7)
    expect(r.ok && r.decision.reasoning).toHaveLength(120)
  })
})

describe('prompt', () => {
  it('restricts the schema to this turn’s options and explains raise semantics', () => {
    const schema = responseFormat(obs) as { json_schema: { schema: { properties: { action: { enum: string[] } } } } }
    expect(schema.json_schema.schema.properties.action.enum).toEqual(obs.options.map((o) => o.id))
    expect(SYSTEM_PROMPT).toContain('"Bet X", "Raise to X" and "All-in X" mean your total bet this street becomes X')
  })
})

describe('chatCompletion', () => {
  it('throws OpenRouterError on non-2xx', async () => {
    const { fn } = fakeFetch([{ status: 402, body: '{"error":"insufficient credits"}' }])
    await expect(chatCompletion({ apiKey: 'k', fetch: fn }, { model: 'm', messages: [] })).rejects.toBeInstanceOf(OpenRouterError)
  })
})

describe('LlmPlayer', () => {
  const make = (fn: ReturnType<typeof fakeFetch>['fn']) =>
    new LlmPlayer({ id: 'pill', model: 'vendor/model', openrouter: { apiKey: 'test-key', fetch: fn } })

  it('sends the prompt with structured output, low temperature and reasoning off, and reports cost', async () => {
    const fake = fakeFetch([{ content: valid, cost: 0.0021 }])
    const res = await make(fake.fn).decide(obs, signal)
    expect(res).toMatchObject({ ok: true, model: 'vendor/model-2026', usage: { inputTokens: 400, outputTokens: 50, costUsd: 0.0021, retries: 0 } })
    const req = fake.requests[0]!
    expect(req.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(req.headers.Authorization).toBe('Bearer test-key')
    expect(req.body).toMatchObject({ model: 'vendor/model', temperature: 0.3, max_tokens: 150, reasoning: { effort: 'none' }, provider: { require_parameters: true } })
    expect((req.body.messages as Array<{ role: string }>).map((m) => m.role)).toEqual(['system', 'user'])
  })

  it('retries once with the specific error, summing usage', async () => {
    const fake = fakeFetch([{ content: '{"action":"shove"}', cost: 0.001 }, { content: valid, cost: 0.001 }])
    const res = await make(fake.fn).decide(obs, signal)
    expect(res).toMatchObject({ ok: true, usage: { inputTokens: 800, costUsd: 0.002, retries: 1 } })
    const retryMessages = fake.requests[1]!.body.messages as Array<{ role: string; content: string }>
    expect(retryMessages.at(-1)!.content).toMatch(/invalid: "action" must be one of/)
  })

  it('gives up after a second invalid reply, still reporting what it cost', async () => {
    const fake = fakeFetch([{ content: 'hmm' }, { content: 'still no' }])
    const res = await make(fake.fn).decide(obs, signal)
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/^invalid output/), usage: { costUsd: 0.002, retries: 1 } })
  })

  it('returns a failure (not a throw) on HTTP errors', async () => {
    const fake = fakeFetch([{ status: 500, body: 'upstream down' }])
    const res = await make(fake.fn).decide(obs, signal)
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/OpenRouter 500/) })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/players exec vitest run test/llm.test.ts`
Expected: FAIL, cannot resolve `../src/llm/llm-player`.

- [ ] **Step 3: Implement**

`packages/players/src/llm/openrouter.ts`:

```ts
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
  response_format?: unknown
  reasoning?: { effort?: 'none' | 'minimal' | 'low'; enabled?: boolean }
  provider?: { require_parameters?: boolean }
}

export interface ChatResult {
  content: string
  /** Model that actually served the request. */
  model: string
  promptTokens: number
  completionTokens: number
  /** Cost in OpenRouter credits (USD), as reported in `usage.cost`; 0 if absent. */
  cost: number
}

export class OpenRouterError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`OpenRouter ${status}: ${body.slice(0, 300)}`)
  }
}

export interface OpenRouterConfig {
  apiKey: string
  baseUrl?: string
  fetch?: Fetch
  /** Sent as HTTP-Referer / X-Title so the app shows up in OpenRouter's dashboard. */
  referer?: string
  title?: string
}

/** One non-streaming chat completion. Throws OpenRouterError on non-2xx. */
export async function chatCompletion(
  config: OpenRouterConfig,
  request: ChatRequest,
  signal?: AbortSignal,
): Promise<ChatResult> {
  const doFetch = config.fetch ?? fetch
  const res = await doFetch(`${config.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': config.referer ?? 'https://github.com/0xjba/artificialBluff',
      'X-Title': config.title ?? 'artificialBluff',
    },
    body: JSON.stringify(request),
    signal,
  })
  const text = await res.text()
  if (!res.ok) throw new OpenRouterError(res.status, text)
  const body = JSON.parse(text) as {
    model?: string
    choices?: Array<{ message?: { content?: string | null } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
  }
  return {
    content: body.choices?.[0]?.message?.content ?? '',
    model: body.model ?? request.model,
    promptTokens: body.usage?.prompt_tokens ?? 0,
    completionTokens: body.usage?.completion_tokens ?? 0,
    cost: body.usage?.cost ?? 0,
  }
}
```

`packages/players/src/llm/prompt.ts`:

```ts
import type { Observation } from '../types'

/**
 * System prompt for every LLM seat. Derived from the original House of TEN prompt, fixing its
 * known defects: options and raise semantics are explicit, amounts are precomputed, and the
 * model states a win probability for calibration.
 */
export const SYSTEM_PROMPT = `You are playing No-Limit Texas Hold'em. On each turn you receive the game state as JSON and choose exactly one of the offered options.

The state contains: your hole cards ("hole"), the board, your position, every seat's position, chips behind ("stack"), chips bet this street ("bet") and status (the seat with "you": true is you), this hand's action history, and computed facts: pot, amount to call, pot odds, effective stack in big blinds, and stack-to-pot ratio. Opponents are identified only by position.

Every option offered is legal. "Call X" adds X chips; "Bet X", "Raise to X" and "All-in X" mean your total bet this street becomes X. In the history, "posts" and "calls X" show chips added, while "bets X" and "raises to X" show that player's street total.

Your goal is to maximise your expected chips.

Reply with only a JSON object, no other text:
{"action": "<one option id>", "win_probability": <number 0 to 1: the probability you win this hand>, "confidence": <number 0 to 1: how sure you are this is the best action>, "reasoning": "<at most 120 characters>"}`

/** The user message: the observation as compact JSON. */
export function userMessage(obs: Observation): string {
  return JSON.stringify(obs)
}

/** JSON schema for structured output, restricted to this turn's option ids. */
export function responseFormat(obs: Observation): unknown {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'poker_decision',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: obs.options.map((o) => o.id) },
          win_probability: { type: 'number' },
          confidence: { type: 'number' },
          reasoning: { type: 'string' },
        },
        required: ['action', 'win_probability', 'confidence', 'reasoning'],
        additionalProperties: false,
      },
    },
  }
}
```

`packages/players/src/llm/parse.ts`:

```ts
import type { OptionId } from '@ab/engine'
import type { Decision, Observation } from '../types'

export const MAX_REASONING = 120

export type ParseResult = { ok: true; decision: Decision } | { ok: false; error: string }

function probability(value: unknown, name: string): number | string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `"${name}" must be a number between 0 and 1`
  // Accept percentages (e.g. 70) by scaling, a common model slip.
  const p = value > 1 && value <= 100 ? value / 100 : value
  if (p < 0 || p > 1) return `"${name}" must be between 0 and 1`
  return p
}

/** Parses and validates an LLM reply against the offered options. */
export function parseDecision(content: string, obs: Observation): ParseResult {
  const text = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim()
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'reply was not valid JSON' }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'reply must be a JSON object' }
  }
  const r = raw as Record<string, unknown>
  const ids = obs.options.map((o) => o.id)
  if (typeof r.action !== 'string' || !ids.includes(r.action as OptionId)) {
    return { ok: false, error: `"action" must be one of: ${ids.join(', ')}` }
  }
  const win = probability(r.win_probability, 'win_probability')
  if (typeof win === 'string') return { ok: false, error: win }
  const confidence = probability(r.confidence, 'confidence')
  if (typeof confidence === 'string') return { ok: false, error: confidence }
  const reasoning = typeof r.reasoning === 'string' ? r.reasoning.trim().slice(0, MAX_REASONING) : null
  return {
    ok: true,
    decision: {
      optionId: r.action as OptionId,
      winProbability: win,
      confidence,
      optionProbabilities: null,
      reasoning,
    },
  }
}
```

`packages/players/src/llm/llm-player.ts`:

```ts
import type { DecideResult, Observation, Player, Usage } from '../types'
import { parseDecision } from './parse'
import { SYSTEM_PROMPT, responseFormat, userMessage } from './prompt'
import { chatCompletion, type ChatMessage, type OpenRouterConfig } from './openrouter'

export interface LlmPlayerOptions {
  id: string
  /** OpenRouter model id, e.g. "anthropic/claude-sonnet-5". */
  model: string
  openrouter: OpenRouterConfig
  temperature?: number
  maxTokens?: number
  /** Send reasoning: {effort: 'none'}. Disable for models that always reason (they reject it). */
  disableReasoning?: boolean
  /** Use JSON-schema structured output and route only to endpoints that support it. */
  structuredOutput?: boolean
}

/** An LLM seat via OpenRouter. One retry with the specific error on invalid output. */
export class LlmPlayer implements Player {
  readonly kind = 'llm' as const
  readonly id: string
  readonly model: string

  constructor(private readonly options: LlmPlayerOptions) {
    this.id = options.id
    this.model = options.model
  }

  async decide(obs: Observation, signal: AbortSignal): Promise<DecideResult> {
    const o = this.options
    const structured = o.structuredOutput ?? true
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage(obs) },
    ]
    const usage: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, retries: 0 }
    let servedBy = o.model
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) usage.retries++
      let content: string
      try {
        const res = await chatCompletion(
          o.openrouter,
          {
            model: o.model,
            messages,
            temperature: o.temperature ?? 0.3,
            max_tokens: o.maxTokens ?? 150,
            ...(structured ? { response_format: responseFormat(obs), provider: { require_parameters: true } } : {}),
            ...((o.disableReasoning ?? true) ? { reasoning: { effort: 'none' as const } } : {}),
          },
          signal,
        )
        usage.inputTokens += res.promptTokens
        usage.outputTokens += res.completionTokens
        usage.costUsd += res.cost
        servedBy = res.model
        content = res.content
      } catch (e) {
        return { ok: false, error: (e as Error).message, usage, model: servedBy }
      }
      const parsed = parseDecision(content, obs)
      if (parsed.ok) return { ok: true, decision: parsed.decision, usage, model: servedBy }
      if (attempt === 1) return { ok: false, error: `invalid output: ${parsed.error}`, usage, model: servedBy }
      messages.push(
        { role: 'assistant', content },
        { role: 'user', content: `That reply was invalid: ${parsed.error}. Reply again with only the JSON object.` },
      )
    }
    throw new Error('unreachable')
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/players exec vitest run && pnpm --filter @ab/players typecheck`
Expected: PASS (24 tests); typecheck clean.

- [ ] **Step 5: Commit**


```bash
git add packages/players/src/llm packages/players/test/llm.test.ts
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(players): LLM player via OpenRouter with structured output and one retry" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```


---

### Task 6: Jev player

**Files:**
- Create: `packages/players/src/jev/jev-player.ts`
- Test: `packages/players/test/jev.test.ts`

- [ ] **Step 1: Write the failing test** (real SDK, fake `fetch`)

`packages/players/test/jev.test.ts`:

```ts
import { createHand } from '@ab/engine'
import { describe, expect, it } from 'vitest'
import { ACTION_INSTRUCTIONS, JevPlayer, WIN_INSTRUCTIONS } from '../src/jev/jev-player'
import { buildObservation } from '../src/observation'

const obs = buildObservation(
  createHand({ seats: [{ id: 'a', stack: 1000 }, { id: 'b', stack: 1000 }], buttonIndex: 0, smallBlind: 50, bigBlind: 100, seed: 2 }),
)
const signal = new AbortController().signal

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = []
  const fn = async (url: string, init?: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init!.body)) })
    const r = responses.shift()!
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } })
  }
  return { fn, requests }
}

const okBody = {
  model: 'jev-1.13.0',
  answers: {
    action: { type: 'choice', choice: 'call', confidence: 0.41, probabilities: { fold: 0.1, call: 0.6, all_in: 0.3 } },
    win: { type: 'noul', noul: 0.57 },
  },
  usage: { input_tokens: 500, output_tokens: 3 },
}

describe('JevPlayer', () => {
  it('asks one Choice over the offered options plus a win Noul, and maps the answer', async () => {
    const fake = fakeFetch([{ status: 200, body: okBody }])
    const jev = new JevPlayer({ id: 'jev', model: 'jev-1.13.0', client: { apiKey: 'test', fetch: fake.fn } })
    const res = await jev.decide(obs, signal)
    expect(res).toEqual({
      ok: true,
      decision: {
        optionId: 'call',
        winProbability: 0.57,
        confidence: 0.41,
        optionProbabilities: { fold: 0.1, call: 0.6, all_in: 0.3 },
        reasoning: null,
      },
      usage: { inputTokens: 500, outputTokens: 3, costUsd: (500 * 0.042) / 1e6, retries: 0 },
      model: 'jev-1.13.0',
    })
    const req = fake.requests[0]!
    expect(req.url).toMatch(/\/v1\/systemone$/)
    expect(req.body.model).toBe('jev-1.13.0')
    const questions = req.body.questions as Record<string, { type: string; instructions: string; criteria?: unknown }>
    expect(questions.action).toEqual({
      type: 'choice',
      instructions: ACTION_INSTRUCTIONS,
      criteria: Object.fromEntries(obs.options.map((o) => [o.id, o.label])),
    })
    expect(questions.win).toMatchObject({ type: 'noul', instructions: WIN_INSTRUCTIONS })
    // Same facts as the LLMs get, minus the options (which are the Choice criteria).
    expect(req.body.state).toEqual(JSON.parse(JSON.stringify({ ...obs, options: undefined })))
  })

  it('returns a failure (not a throw) on API errors', async () => {
    const fake = fakeFetch([{ status: 401, body: { error: 'bad key' } }])
    const jev = new JevPlayer({ id: 'jev', model: 'jev-1.13.0', client: { apiKey: 'test', fetch: fake.fn }, maxRetries: 0 })
    const res = await jev.decide(obs, signal)
    expect(res.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/players exec vitest run test/jev.test.ts`
Expected: FAIL, cannot resolve `../src/jev/jev-player`.

- [ ] **Step 3: Implement**

`packages/players/src/jev/jev-player.ts`:

```ts
import { choice, noul, TypeSafeClient, type TypeSafeClientConfig } from '@typesafe-ai/sdk'
import type { OptionId } from '@ab/engine'
import type { DecideResult, Observation, Player } from '../types'

/**
 * Question wording. Jev answers the question as literally written, so keep these exact and
 * change them only with a new pre-registration.
 */
export const ACTION_INSTRUCTIONS =
  'You are the player marked "you": true in this No-Limit Texas Hold\'em hand. Which action maximises your expected chips?'
export const WIN_INSTRUCTIONS =
  'The player marked "you": true wins this hand, either at showdown or because every opponent folds.'

export const JEV_INPUT_PRICE_PER_MTOK = 0.042

export interface JevPlayerOptions {
  id: string
  /** Pinned model version, e.g. "jev-1.13.0". */
  model: string
  /** Passed to TypeSafeClient (apiKey, fetch for tests, etc.). */
  client?: TypeSafeClientConfig
  /** USD per 1M input tokens; output is free. */
  inputPricePerMTok?: number
  /** Retries inside the SDK after the first attempt. */
  maxRetries?: number
}

/** The Jev seat: one systemOne call per decision, a Choice over options plus a win Noul. */
export class JevPlayer implements Player {
  readonly kind = 'jev' as const
  readonly id: string
  readonly model: string
  private readonly client: TypeSafeClient

  constructor(private readonly options: JevPlayerOptions) {
    this.id = options.id
    this.model = options.model
    this.client = new TypeSafeClient({ defaultModel: options.model, ...options.client })
  }

  async decide(obs: Observation, signal: AbortSignal): Promise<DecideResult> {
    const { options, ...state } = obs
    const criteria = Object.fromEntries(options.map((o) => [o.id, o.label]))
    try {
      const res = await this.client.systemOne(
        {
          model: this.model,
          state: JSON.parse(JSON.stringify(state)),
          questions: {
            action: choice(ACTION_INSTRUCTIONS, criteria),
            win: noul(WIN_INSTRUCTIONS),
          },
        },
        { signal, retry: { maxRetries: this.options.maxRetries ?? 1 } },
      )
      const usage = {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        costUsd: (res.usage.input_tokens * (this.options.inputPricePerMTok ?? JEV_INPUT_PRICE_PER_MTOK)) / 1_000_000,
        retries: 0,
      }
      const action = res.answers.action
      return {
        ok: true,
        decision: {
          optionId: action.choice as OptionId,
          winProbability: res.answers.win.noul,
          confidence: action.confidence,
          optionProbabilities: { ...action.probabilities } as Partial<Record<OptionId, number>>,
          reasoning: null,
        },
        usage,
        model: res.model,
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, retries: 0 }, model: this.model }
    }
  }
}
```

The two instruction strings are part of the experiment: changing them changes what Jev is asked, so treat them like pre-registered config.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/players exec vitest run && pnpm --filter @ab/players typecheck`
Expected: PASS (26 tests); typecheck clean.

- [ ] **Step 5: Commit**


```bash
git add packages/players/src/jev packages/players/test/jev.test.ts
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(players): Jev player (Choice over options plus win Noul)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```


---

### Task 7: Player factory and package exports

**Files:**
- Create: `packages/players/src/factory.ts`, `packages/players/src/index.ts`
- Test: `packages/players/test/factory.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/players/test/factory.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createPlayers } from '../src/factory'

describe('createPlayers', () => {
  it('builds each kind from a line-up spec', () => {
    const players = createPlayers(
      [
        { id: 'jev', kind: 'jev', model: 'jev-1.13.0' },
        { id: 'pill', kind: 'llm', model: 'vendor/frontier-a' },
        { id: 'drip', kind: 'bot', bot: 'tag' },
        { id: 'nimbus', kind: 'mock' },
      ],
      { OPENROUTER_API_KEY: 'k', TYPESAFE_API_KEY: 'k' },
    )
    expect(players.map((p) => [p.id, p.kind, p.model])).toEqual([
      ['jev', 'jev', 'jev-1.13.0'],
      ['pill', 'llm', 'vendor/frontier-a'],
      ['drip', 'bot', 'bot/tag'],
      ['nimbus', 'mock', 'mock/llm'],
    ])
  })

  it('fails fast with a clear message when a key is missing, and rejects duplicate ids', () => {
    expect(() => createPlayers([{ id: 'jev', kind: 'jev', model: 'jev-1.13.0' }], {})).toThrow('jev: TYPESAFE_API_KEY is not set')
    expect(() => createPlayers([{ id: 'pill', kind: 'llm', model: 'm' }], {})).toThrow('pill: OPENROUTER_API_KEY is not set')
    expect(() => createPlayers([{ id: 'a', kind: 'mock' }, { id: 'a', kind: 'mock' }], {})).toThrow(/unique/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/players exec vitest run test/factory.test.ts`
Expected: FAIL, cannot resolve `../src/factory`.

- [ ] **Step 3: Implement**

`packages/players/src/factory.ts`:

```ts
import { CallingStation, RandomBot, TagBot } from './bots'
import { JevPlayer } from './jev/jev-player'
import { LlmPlayer } from './llm/llm-player'
import type { Fetch } from './llm/openrouter'
import { MockLlm } from './mock'
import type { Player } from './types'

/** One seat in a line-up config. `id` is the character name (e.g. "jev", "pill"). */
export type PlayerSpec =
  | { id: string; kind: 'jev'; model: string }
  | { id: string; kind: 'llm'; model: string; disableReasoning?: boolean; structuredOutput?: boolean }
  | { id: string; kind: 'bot'; bot: 'random' | 'calling-station' | 'tag'; seed?: number }
  | { id: string; kind: 'mock'; model?: string; inputPricePerMTok?: number }

export interface PlayerEnv {
  OPENROUTER_API_KEY?: string
  TYPESAFE_API_KEY?: string
}

/** Builds a player from its spec. Keys come from `env`; `fetch` is injectable for tests. */
export function createPlayer(spec: PlayerSpec, env: PlayerEnv, fetchImpl?: Fetch): Player {
  switch (spec.kind) {
    case 'jev': {
      if (!env.TYPESAFE_API_KEY) throw new Error(`${spec.id}: TYPESAFE_API_KEY is not set`)
      return new JevPlayer({ id: spec.id, model: spec.model, client: { apiKey: env.TYPESAFE_API_KEY, ...(fetchImpl ? { fetch: fetchImpl } : {}) } })
    }
    case 'llm': {
      if (!env.OPENROUTER_API_KEY) throw new Error(`${spec.id}: OPENROUTER_API_KEY is not set`)
      return new LlmPlayer({
        id: spec.id,
        model: spec.model,
        openrouter: { apiKey: env.OPENROUTER_API_KEY, ...(fetchImpl ? { fetch: fetchImpl } : {}) },
        ...(spec.disableReasoning !== undefined ? { disableReasoning: spec.disableReasoning } : {}),
        ...(spec.structuredOutput !== undefined ? { structuredOutput: spec.structuredOutput } : {}),
      })
    }
    case 'bot':
      if (spec.bot === 'random') return new RandomBot(spec.id, spec.seed ?? 1)
      if (spec.bot === 'calling-station') return new CallingStation(spec.id)
      return new TagBot(spec.id)
    case 'mock':
      return new MockLlm(spec.id, spec.model ?? 'mock/llm', { inputPricePerMTok: spec.inputPricePerMTok ?? 1 })
  }
}

export function createPlayers(specs: PlayerSpec[], env: PlayerEnv, fetchImpl?: Fetch): Player[] {
  const ids = specs.map((s) => s.id)
  if (new Set(ids).size !== ids.length) throw new Error('player ids must be unique')
  return specs.map((s) => createPlayer(s, env, fetchImpl))
}
```

`packages/players/src/index.ts`:

```ts
export * from './types'
export * from './observation'
export * from './bots'
export * from './mock'
export * from './llm/openrouter'
export * from './llm/prompt'
export * from './llm/parse'
export * from './llm/llm-player'
export * from './jev/jev-player'
export * from './factory'
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/players exec vitest run && pnpm --filter @ab/players typecheck`
Expected: PASS (28 tests); typecheck clean.

- [ ] **Step 5: Commit**


```bash
git add packages/players/src/factory.ts packages/players/src/index.ts packages/players/test/factory.test.ts
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(players): line-up factory and exports" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```


---

### Task 8: Core package, event types and SQLite event store

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`
- Modify: `package.json` (root: allow the better-sqlite3 native build)
- Create: `packages/core/src/events.ts`, `packages/core/src/store.ts`
- Test: `packages/core/test/store.test.ts`

- [ ] **Step 1: Create the package**

`packages/core/package.json`:

```json
{
  "name": "@ab/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ab/engine": "workspace:*",
    "@ab/players": "workspace:*",
    "better-sqlite3": "^12.2.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13"
  }
}
```

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test", "scripts"]
}
```

In the root `package.json`, add a top-level `pnpm` field (pnpm 10 blocks native build scripts unless listed):
```json
  "pnpm": {
    "onlyBuiltDependencies": ["better-sqlite3"]
  }
```
Run: `pnpm install` (better-sqlite3 compiles or downloads a prebuilt binary; allow a minute).
Check: `node -e "const D=require('./packages/core/node_modules/better-sqlite3'); console.log(new D(':memory:').prepare('select sqlite_version() v').get())"` prints a version.

- [ ] **Step 2: Create the event types**

`packages/core/src/events.ts`:

```ts
import type { Action, Card, EndReason, HandCategory, OptionId, Position, Street } from '@ab/engine'
import type { PlayerKind } from '@ab/players'

export type GameKind = 'live' | 'study'

export interface PlayerInfo {
  id: string
  kind: PlayerKind
  model: string
}

export interface DecisionEvent {
  type: 'decision'
  handId: string | null
  street: Street
  playerId: string
  position: Position
  /** Model that answered (as reported by the provider), or the configured one on failure. */
  model: string
  optionId: OptionId
  label: string
  action: Action
  /** Chips moved from the player's stack by this action. */
  chipsIn: number
  /** Pot before the action. */
  pot: number
  toCall: number
  winProbability: number | null
  confidence: number | null
  optionProbabilities: Partial<Record<OptionId, number>> | null
  reasoning: string | null
  latencyMs: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  retries: number
  /** True when the runner substituted check-or-fold for the player's answer. */
  fallback: boolean
  /** Why it fell back: the player's error, "timeout", "invalid option: x", or "auto: too many failures". */
  fallbackReason: string | null
}

export type EventBody =
  | { type: 'game_started'; kind: GameKind; players: PlayerInfo[] }
  | {
      type: 'hand_started'
      handId: string | null
      buttonIndex: number
      smallBlind: number
      bigBlind: number
      seats: Array<{ playerId: string; stack: number; position: Position }>
      posts: Array<{ playerId: string; blind: 'sb' | 'bb'; amount: number }>
    }
  | { type: 'cards_dealt'; handId: string | null; holes: Record<string, Card[]> }
  | { type: 'turn_started'; handId: string | null; playerId: string; options: Array<{ id: OptionId; label: string }> }
  | DecisionEvent
  | { type: 'street_dealt'; handId: string | null; street: Street; cards: Card[]; board: Card[] }
  | {
      type: 'showdown'
      handId: string | null
      hands: Record<string, { hole: Card[]; category: HandCategory; label: string; value: number }>
    }
  | { type: 'pot_awarded'; handId: string | null; amount: number; eligible: string[]; winners: string[]; shares: Record<string, number> }
  | { type: 'hand_ended'; handId: string | null; stacks: Record<string, number>; net: Record<string, number> }
  | {
      type: 'game_ended'
      reason: EndReason
      winner: string | null
      stacks: Record<string, number>
      eliminated: string[]
      handsPlayed: number
    }

export type EventType = EventBody['type']

export type GameEvent = EventBody & { gameId: string; seq: number; ts: number }

/** Where the runner writes events. The store assigns seq and ts. */
export interface EventSink {
  append(body: EventBody): GameEvent
}
```

- [ ] **Step 3: Write the failing test**

`packages/core/test/store.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DecisionEvent } from '../src/events'
import { configHash, EventStore } from '../src/store'

const decision = (over: Partial<DecisionEvent> = {}): DecisionEvent => ({
  type: 'decision', handId: 'hand-0', street: 'preflop', playerId: 'jev', position: 'BTN', model: 'jev-1.13.0',
  optionId: 'call', label: 'Call 100', action: { type: 'call' }, chipsIn: 100, pot: 150, toCall: 100,
  winProbability: 0.5, confidence: 0.4, optionProbabilities: { call: 0.6, fold: 0.4 }, reasoning: null,
  latencyMs: 120, inputTokens: 500, outputTokens: 2, costUsd: 0.000021, retries: 0, fallback: false, fallbackReason: null,
  ...over,
})

describe('EventStore', () => {
  it('hashes configs canonically (key order does not matter)', () => {
    expect(configHash({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(configHash({ b: { d: [1, 2], c: 2 }, a: 1 }))
    expect(configHash({ a: 1 })).not.toBe(configHash({ a: 2 }))
  })

  it('records games and appends events in order with seq and ts', () => {
    const store = new EventStore()
    const game = store.createGame('g1', 'live', { z: 1, a: 2 }, 1000)
    expect(game).toMatchObject({ id: 'g1', kind: 'live', status: 'running', config: { a: 2, z: 1 }, createdAt: 1000 })
    const e1 = store.append('g1', { type: 'game_started', kind: 'live', players: [] }, 2000)
    const e2 = store.append('g1', decision(), 3000)
    expect([e1.seq, e2.seq]).toEqual([1, 2])
    expect(store.events('g1').map((e) => [e.seq, e.type, e.ts])).toEqual([
      [1, 'game_started', 2000],
      [2, 'decision', 3000],
    ])
    expect(store.events('g1', 1)).toHaveLength(1)
    expect(store.events('g1')[1]).toEqual({ ...decision(), gameId: 'g1', seq: 2, ts: 3000 })
  })

  it('denormalizes decisions and sums game cost', () => {
    const store = new EventStore()
    store.createGame('g1', 'live', {})
    store.append('g1', decision({ costUsd: 0.01 }))
    store.append('g1', decision({ costUsd: 0.02, playerId: 'pill', fallback: true, fallbackReason: 'timeout' }))
    expect(store.gameCost('g1')).toBeCloseTo(0.03)
    const rows = store.db.prepare('SELECT player_id, fallback, action_type FROM decisions ORDER BY seq').all()
    expect(rows).toEqual([
      { player_id: 'jev', fallback: 0, action_type: 'call' },
      { player_id: 'pill', fallback: 1, action_type: 'call' },
    ])
  })

  it('marks games left running as interrupted', () => {
    const store = new EventStore()
    store.createGame('a', 'live', {})
    store.createGame('b', 'live', {})
    store.setStatus('b', 'ended')
    expect(store.interruptRunningGames()).toEqual(['a'])
    expect(store.game('a')!.status).toBe('interrupted')
    expect(store.games('live').map((g) => g.id)).toEqual(['a', 'b'])
  })

  it('persists to a file', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const path = join(mkdtempSync(join(tmpdir(), 'ab-')), 'events.db')
    const a = new EventStore(path)
    a.createGame('g', 'study', { x: 1 })
    a.append('g', { type: 'game_started', kind: 'study', players: [] })
    a.close()
    const b = new EventStore(path)
    expect(b.events('g')).toHaveLength(1)
    b.close()
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @ab/core exec vitest run test/store.test.ts`
Expected: FAIL, cannot resolve `../src/store`.

- [ ] **Step 5: Implement**

`packages/core/src/store.ts`:

```ts
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import type { EventBody, EventSink, GameEvent, GameKind } from './events'

export type GameStatus = 'running' | 'ended' | 'interrupted'

export interface GameRow {
  id: string
  kind: GameKind
  createdAt: number
  status: GameStatus
  config: unknown
  configHash: string
  endedAt: number | null
}

/** JSON with object keys sorted, so equal configs hash equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function configHash(config: unknown): string {
  return createHash('sha256').update(canonicalJson(config)).digest('hex')
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  config_json TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  ended_at INTEGER
);
CREATE TABLE IF NOT EXISTS events (
  game_id TEXT NOT NULL REFERENCES games(id),
  seq INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  hand_id TEXT,
  body_json TEXT NOT NULL,
  PRIMARY KEY (game_id, seq)
);
CREATE TABLE IF NOT EXISTS decisions (
  game_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  hand_id TEXT,
  player_id TEXT NOT NULL,
  model TEXT NOT NULL,
  street TEXT NOT NULL,
  position TEXT NOT NULL,
  option_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  chips_in INTEGER NOT NULL,
  pot INTEGER NOT NULL,
  to_call INTEGER NOT NULL,
  win_probability REAL,
  confidence REAL,
  latency_ms REAL NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  retries INTEGER NOT NULL,
  fallback INTEGER NOT NULL,
  PRIMARY KEY (game_id, seq)
);
CREATE INDEX IF NOT EXISTS decisions_player ON decisions(player_id);
`

/** SQLite event log. Every game is an ordered event stream; decisions are also denormalized for analysis. */
export class EventStore {
  readonly db: Database.Database

  constructor(path = ':memory:') {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(SCHEMA)
  }

  createGame(id: string, kind: GameKind, config: unknown, now = Date.now()): GameRow {
    const hash = configHash(config)
    this.db
      .prepare('INSERT INTO games (id, kind, created_at, status, config_json, config_hash) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, kind, now, 'running', canonicalJson(config), hash)
    return this.game(id)!
  }

  game(id: string): GameRow | null {
    const row = this.db.prepare('SELECT * FROM games WHERE id = ?').get(id) as
      | { id: string; kind: GameKind; created_at: number; status: GameStatus; config_json: string; config_hash: string; ended_at: number | null }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      kind: row.kind,
      createdAt: row.created_at,
      status: row.status,
      config: JSON.parse(row.config_json),
      configHash: row.config_hash,
      endedAt: row.ended_at,
    }
  }

  games(kind?: GameKind): GameRow[] {
    const ids = (kind
      ? this.db.prepare('SELECT id FROM games WHERE kind = ? ORDER BY created_at').all(kind)
      : this.db.prepare('SELECT id FROM games ORDER BY created_at').all()) as Array<{ id: string }>
    return ids.map((r) => this.game(r.id)!)
  }

  setStatus(id: string, status: GameStatus, now = Date.now()): void {
    this.db.prepare('UPDATE games SET status = ?, ended_at = ? WHERE id = ?').run(status, status === 'running' ? null : now, id)
  }

  /** Marks games left 'running' by a crash as 'interrupted'. Call on server start. Returns their ids. */
  interruptRunningGames(now = Date.now()): string[] {
    const ids = (this.db.prepare("SELECT id FROM games WHERE status = 'running'").all() as Array<{ id: string }>).map((r) => r.id)
    for (const id of ids) this.setStatus(id, 'interrupted', now)
    return ids
  }

  append(gameId: string, body: EventBody, now = Date.now()): GameEvent {
    const tx = this.db.transaction((): GameEvent => {
      const { next } = this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM events WHERE game_id = ?').get(gameId) as { next: number }
      const event = { ...body, gameId, seq: next, ts: now } as GameEvent
      const handId = 'handId' in body ? body.handId : null
      this.db
        .prepare('INSERT INTO events (game_id, seq, ts, type, hand_id, body_json) VALUES (?, ?, ?, ?, ?, ?)')
        .run(gameId, next, now, body.type, handId, JSON.stringify(body))
      if (body.type === 'decision') {
        this.db
          .prepare(
            `INSERT INTO decisions (game_id, seq, hand_id, player_id, model, street, position, option_id, action_type, chips_in, pot, to_call,
             win_probability, confidence, latency_ms, input_tokens, output_tokens, cost_usd, retries, fallback)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            gameId, next, body.handId, body.playerId, body.model, body.street, body.position, body.optionId, body.action.type,
            body.chipsIn, body.pot, body.toCall, body.winProbability, body.confidence, body.latencyMs,
            body.inputTokens, body.outputTokens, body.costUsd, body.retries, body.fallback ? 1 : 0,
          )
      }
      return event
    })
    return tx()
  }

  /** A sink bound to one game, for the runner. */
  sink(gameId: string, now: () => number = Date.now): EventSink {
    return { append: (body) => this.append(gameId, body, now()) }
  }

  events(gameId: string, afterSeq = 0): GameEvent[] {
    const rows = this.db
      .prepare('SELECT seq, ts, body_json FROM events WHERE game_id = ? AND seq > ? ORDER BY seq')
      .all(gameId, afterSeq) as Array<{ seq: number; ts: number; body_json: string }>
    return rows.map((r) => ({ ...(JSON.parse(r.body_json) as EventBody), gameId, seq: r.seq, ts: r.ts }) as GameEvent)
  }

  /** Total spent by all players in a game (USD). */
  gameCost(gameId: string): number {
    const { total } = this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM decisions WHERE game_id = ?').get(gameId) as { total: number }
    return total
  }

  close(): void {
    this.db.close()
  }
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @ab/core exec vitest run test/store.test.ts`
Expected: PASS (5 tests). (Full core typecheck comes in Task 10 once `index.ts` and scripts exist; `pnpm --filter @ab/core exec tsc --noEmit` should already be clean.)

- [ ] **Step 7: Commit**


```bash
git add package.json pnpm-lock.yaml packages/core/package.json packages/core/tsconfig.json packages/core/src/events.ts packages/core/src/store.ts packages/core/test/store.test.ts
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(core): event types and SQLite event store" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```


---

### Task 9: Table runner

**Files:**
- Create: `packages/core/src/runner.ts`
- Create: `packages/core/test/deck.ts` (test helper)
- Test: `packages/core/test/runner.test.ts`

- [ ] **Step 1: Write the test helper and the failing test**

`packages/core/test/deck.ts`:

```ts
import { fullDeck, type Card } from '@ab/engine'

/** Deck that deals `holes` (seat order) and `board`, dealing from left of the button with burns. */
export function arrangeDeckForTests(buttonIndex: number, holes: string[][], board: string[]): Card[] {
  const n = holes.length
  const order = Array.from({ length: n }, (_, k) => (buttonIndex + 1 + k) % n)
  const used = new Set([...holes.flat(), ...board])
  const spare = fullDeck().filter((c) => !used.has(c))
  const top: string[] = []
  for (let round = 0; round < 2; round++) for (const i of order) top.push(holes[i]![round]!)
  top.push(spare.shift()!, board[0]!, board[1]!, board[2]!, spare.shift()!, board[3]!, spare.shift()!, board[4]!)
  return [...(top as Card[]), ...spare]
}
```

`packages/core/test/runner.test.ts`:

```ts
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

  it('falls back to check-or-fold on timeout, invalid option and thrown errors', async () => {
    const cases: Array<[Player, RegExp]> = [
      [new Scripted('x', () => new Promise(() => {})), /^timeout$/],
      [new Scripted('x', () => ({ ok: true, decision: { optionId: 'bogus' as never, winProbability: null, confidence: null, optionProbabilities: null, reasoning: null }, usage: NO_USAGE, model: 'scripted' })), /^invalid option: bogus$/],
      [new Scripted('x', () => Promise.reject(new Error('boom'))), /^boom$/],
    ]
    for (const [bad, reason] of cases) {
      const sink = memorySink()
      // x is UTG facing the big blind: fallback must be a fold.
      await playHand({ config: config(['b', 's', 'bb', 'x']), players: byId([new CallingStation('b'), new CallingStation('s'), new CallingStation('bb'), bad]), sink, decisionTimeoutMs: 20 })
      const d = decisions(sink.events).find((e) => e.playerId === 'x')!
      expect(d).toMatchObject({ optionId: 'fold', fallback: true, winProbability: null })
      expect(d.fallbackReason).toMatch(reason)
    }
  })

  it('stops asking a player after 3 consecutive failures in a hand', async () => {
    const failing = new Scripted('f', () => ({ ok: false, error: 'provider down', usage: NO_USAGE, model: 'scripted' }))
    const sink = memorySink()
    // f is the big blind; the others only check/call, so f is asked preflop, flop, turn and river.
    await playHand({ config: config(['b', 's', 'f']), players: byId([new CallingStation('b'), new CallingStation('s'), failing]), sink, decisionTimeoutMs: 100 })
    const mine = decisions(sink.events).filter((e) => e.playerId === 'f')
    expect(mine.map((d) => d.fallbackReason)).toEqual(['provider down', 'provider down', 'provider down', 'auto: too many failures'])
    expect(mine.every((d) => d.optionId === 'check')).toBe(true)
    expect(failing.calls).toBe(3)
  })

  it('records cost and usage from failed decisions too', async () => {
    const costly = new Scripted('x', () => ({ ok: false, error: 'invalid output: bad', usage: { inputTokens: 900, outputTokens: 80, costUsd: 0.004, retries: 1 }, model: 'vendor/m' }))
    const sink = memorySink()
    await playHand({ config: config(['b', 's', 'bb', 'x']), players: byId([new CallingStation('b'), new CallingStation('s'), new CallingStation('bb'), costly]), sink, decisionTimeoutMs: 100 })
    expect(decisions(sink.events).find((e) => e.playerId === 'x')).toMatchObject({ costUsd: 0.004, retries: 1, inputTokens: 900, model: 'vendor/m', fallback: true })
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

  it('rejects a config with a seat that has no player', async () => {
    await expect(playHand({ config: config(['a', 'b']), players: byId([new CallingStation('a')]), sink: memorySink(), decisionTimeoutMs: 10 })).rejects.toThrow(/no player for seat b/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/core exec vitest run test/runner.test.ts`
Expected: FAIL, cannot resolve `../src/runner`.

- [ ] **Step 3: Implement**

`packages/core/src/runner.ts`:

```ts
import {
  applyAction,
  buildMenu,
  createHand,
  positions,
  potSize,
  type HandConfig,
  type HandResult,
  type HandState,
  type MenuConfig,
  type Street,
} from '@ab/engine'
import { buildObservation, checkOrFold, NO_USAGE, type DecideResult, type Player } from '@ab/players'
import type { EventSink } from './events'

export interface PlayHandOptions {
  config: HandConfig
  /** Every player seated in `config.seats`, by id. */
  players: ReadonlyMap<string, Player>
  sink: EventSink
  /** Per-decision limit; on expiry the player checks if free, otherwise folds. */
  decisionTimeoutMs: number
  /** Live pacing: minimum wall time per action (the difference is slept). 0 for the study. */
  paceMs?: number
  /** Consecutive fallbacks after which a player auto check/folds for the rest of the hand. */
  maxConsecutiveFallbacks?: number
  menu?: Partial<MenuConfig>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const STREET_AT: Record<number, Street> = { 3: 'flop', 4: 'turn', 5: 'river' }

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Calls the player under a timeout. Never throws: rejections and timeouts become failures. */
async function ask(player: Player, obs: Parameters<Player['decide']>[0], timeoutMs: number): Promise<DecideResult> {
  const ac = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<DecideResult>((resolve) => {
    timer = setTimeout(() => {
      ac.abort()
      resolve({ ok: false, error: 'timeout', usage: NO_USAGE, model: player.model })
    }, timeoutMs)
  })
  try {
    return await Promise.race([
      player.decide(obs, ac.signal).catch(
        (e: unknown): DecideResult => ({ ok: false, error: (e as Error).message ?? String(e), usage: NO_USAGE, model: player.model }),
      ),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Emits a street_dealt event for each street whose cards appeared since `fromLength`. */
function emitStreets(sink: EventSink, state: HandState, fromLength: number): void {
  for (const length of [3, 4, 5]) {
    if (fromLength < length && state.board.length >= length) {
      const start = length === 3 ? 0 : length - 1
      sink.append({
        type: 'street_dealt',
        handId: state.config.handId ?? null,
        street: STREET_AT[length]!,
        cards: state.board.slice(start, length),
        board: state.board.slice(0, length),
      })
    }
  }
}

/** Plays one hand to completion, writing every event to `sink`. */
export async function playHand(opts: PlayHandOptions): Promise<HandResult> {
  const sleep = opts.sleep ?? defaultSleep
  const now = opts.now ?? (() => performance.now())
  const maxFallbacks = opts.maxConsecutiveFallbacks ?? 3
  const handId = opts.config.handId ?? null
  for (const s of opts.config.seats) {
    if (!opts.players.has(s.id)) throw new Error(`no player for seat ${s.id}`)
  }

  let state = createHand(opts.config)
  const names = positions(state.seats.length, state.config.buttonIndex)
  opts.sink.append({
    type: 'hand_started',
    handId,
    buttonIndex: state.config.buttonIndex,
    smallBlind: state.config.smallBlind,
    bigBlind: state.config.bigBlind,
    seats: state.seats.map((s, i) => ({ playerId: s.id, stack: s.startingStack, position: names[i]! })),
    posts: state.history
      .filter((h) => h.kind === 'post_sb' || h.kind === 'post_bb')
      .map((h) => ({ playerId: h.playerId, blind: h.kind === 'post_sb' ? ('sb' as const) : ('bb' as const), amount: h.amount })),
  })
  opts.sink.append({ type: 'cards_dealt', handId, holes: Object.fromEntries(state.seats.map((s) => [s.id, [...s.hole]])) })
  emitStreets(opts.sink, state, 0)

  const consecutiveFallbacks = new Map<string, number>()
  while (!state.complete) {
    const seatIndex = state.toAct!
    const seat = state.seats[seatIndex]!
    const player = opts.players.get(seat.id)!
    const menu = buildMenu(state, opts.menu)
    const obs = buildObservation(state, menu)
    opts.sink.append({ type: 'turn_started', handId, playerId: seat.id, options: obs.options })

    const started = now()
    const auto = (consecutiveFallbacks.get(seat.id) ?? 0) >= maxFallbacks
    const res: DecideResult = auto
      ? { ok: false, error: 'auto: too many failures', usage: NO_USAGE, model: player.model }
      : await ask(player, obs, opts.decisionTimeoutMs)
    const latencyMs = auto ? 0 : now() - started

    let chosen = res.ok ? menu.find((o) => o.id === res.decision.optionId) : undefined
    let fallbackReason: string | null = null
    if (!res.ok) fallbackReason = res.error
    else if (!chosen) fallbackReason = `invalid option: ${res.decision.optionId}`
    if (!chosen) chosen = menu.find((o) => o.id === checkOrFold(obs))!
    consecutiveFallbacks.set(seat.id, fallbackReason ? (consecutiveFallbacks.get(seat.id) ?? 0) + 1 : 0)

    if (opts.paceMs && latencyMs < opts.paceMs) await sleep(opts.paceMs - latencyMs)

    const decision = res.ok && fallbackReason === null ? res.decision : null
    opts.sink.append({
      type: 'decision',
      handId,
      street: state.street,
      playerId: seat.id,
      position: names[seatIndex]!,
      model: res.model,
      optionId: chosen.id,
      label: chosen.label,
      action: chosen.action,
      chipsIn: chosen.cost,
      pot: potSize(state),
      toCall: obs.facts.toCall,
      winProbability: decision?.winProbability ?? null,
      confidence: decision?.confidence ?? null,
      optionProbabilities: decision?.optionProbabilities ?? null,
      reasoning: decision?.reasoning ?? null,
      latencyMs,
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      costUsd: res.usage.costUsd,
      retries: res.usage.retries,
      fallback: fallbackReason !== null,
      fallbackReason,
    })

    const boardBefore = state.board.length
    state = applyAction(state, chosen.action)
    emitStreets(opts.sink, state, boardBefore)
  }

  const result = state.result!
  if (result.showdown) {
    opts.sink.append({
      type: 'showdown',
      handId,
      hands: Object.fromEntries(
        Object.entries(result.hands).map(([id, v]) => [
          id,
          { hole: [...state.seats.find((s) => s.id === id)!.hole], category: v.category, label: v.label, value: v.value },
        ]),
      ),
    })
  }
  for (const award of result.awards) {
    opts.sink.append({ type: 'pot_awarded', handId, amount: award.amount, eligible: award.eligible, winners: award.winners, shares: award.shares })
  }
  opts.sink.append({ type: 'hand_ended', handId, stacks: result.stacks, net: result.net })
  return result
}
```

Key points:
- `ask` races the player against the timeout and aborts the player's signal on expiry; rejections become failures, so a hand can never stall.
- Fallback is chosen from the same menu (`checkOrFold`), so it is always legal.
- `emitStreets` compares board length before and after each action, so an all-in run-out emits flop, turn and river in order, and a hand decided during the blinds still emits its board.
- Latency is measured around the player's call only; pacing sleeps the remainder of `paceMs` afterwards.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @ab/core exec vitest run`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**


```bash
git add packages/core/src/runner.ts packages/core/test/deck.ts packages/core/test/runner.test.ts
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(core): table runner with timeouts, fallbacks and full event stream" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```


---

### Task 10: Live tournament driver and exports

**Files:**
- Create: `packages/core/src/game.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/game.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/game.test.ts`:

```ts
import { liveTurboConfig } from '@ab/engine'
import { CallingStation, MockLlm, TagBot, type Player } from '@ab/players'
import { describe, expect, it } from 'vitest'
import type { GameEvent } from '../src/events'
import { runTournamentGame } from '../src/game'
import { EventStore } from '../src/store'

const lineup = (): Player[] => [new MockLlm('jev'), new TagBot('pill'), new MockLlm('block'), new CallingStation('drip'), new MockLlm('nimbus')]
const ended = (events: GameEvent[]) => events.at(-1) as Extract<GameEvent, { type: 'game_ended' }>

describe('runTournamentGame', () => {
  it('plays a full live tournament into the store, conserving chips', async () => {
    const store = new EventStore()
    const t = await runTournamentGame({ gameId: 'g1', players: lineup(), tournament: liveTurboConfig('seed-1'), store, decisionTimeoutMs: 1000, budgetUsd: 100 })
    expect(t.complete).toBe(true)
    const events = store.events('g1')
    expect(events[0]!.type).toBe('game_started')
    expect(ended(events)).toMatchObject({ type: 'game_ended', winner: t.winner, handsPlayed: t.handNumber })
    expect(Object.values(ended(events).stacks).reduce((a, b) => a + b, 0)).toBe(15_000)
    expect(store.game('g1')!.status).toBe('ended')
    expect(events.filter((e) => e.type === 'hand_started')).toHaveLength(t.handNumber)
    // Hand ids run hand-0, hand-1, ... in order.
    const ids = events.filter((e) => e.type === 'hand_ended').map((e) => (e as { handId: string }).handId)
    expect(ids).toEqual(ids.map((_, i) => `hand-${i}`))
  })

  it('is reproducible: same seed and deterministic players give identical event streams', async () => {
    const run = async () => {
      const store = new EventStore()
      await runTournamentGame({ gameId: 'g', players: lineup(), tournament: liveTurboConfig('same'), store, decisionTimeoutMs: 1000, budgetUsd: 100, now: () => 0 })
      return store.events('g').map(({ ts: _ts, ...e }) => e)
    }
    expect(await run()).toEqual(await run())
  })

  it('ends at the budget cap after the hand in which it is reached', async () => {
    const store = new EventStore()
    const pricey = lineup().map((p) => new MockLlm(p.id, 'mock/pricey', { inputPricePerMTok: 50_000 }))
    const t = await runTournamentGame({ gameId: 'g2', players: pricey, tournament: liveTurboConfig('s'), store, decisionTimeoutMs: 1000, budgetUsd: 0.5 })
    expect(t.endReason).toBe('budget_cap')
    expect(t.handNumber).toBeGreaterThanOrEqual(1)
    expect(store.gameCost('g2')).toBeGreaterThanOrEqual(0.5)
    expect(ended(store.events('g2')).reason).toBe('budget_cap')
  })

  it('stops as interrupted when the signal aborts', async () => {
    const store = new EventStore()
    const ac = new AbortController()
    ac.abort()
    const t = await runTournamentGame({ gameId: 'g3', players: lineup(), tournament: liveTurboConfig('s'), store, decisionTimeoutMs: 1000, budgetUsd: 100, signal: ac.signal })
    expect(t.endReason).toBe('interrupted')
    expect(store.game('g3')!.status).toBe('interrupted')
  })

  it('records the line-up and settings in the pre-registered game config', async () => {
    const store = new EventStore()
    await runTournamentGame({ gameId: 'g4', players: lineup(), tournament: { ...liveTurboConfig('s'), maxHands: 2 }, store, decisionTimeoutMs: 1000, budgetUsd: 1, meta: { note: 'test' } })
    const game = store.game('g4')!
    expect(game.config).toMatchObject({ budgetUsd: 1, decisionTimeoutMs: 1000, note: 'test', players: [{ id: 'jev', kind: 'mock', model: 'mock/llm' }, { id: 'pill' }, { id: 'block' }, { id: 'drip' }, { id: 'nimbus' }] })
    expect(game.configHash).toMatch(/^[0-9a-f]{64}$/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/core exec vitest run test/game.test.ts`
Expected: FAIL, cannot resolve `../src/game`.

- [ ] **Step 3: Implement**

`packages/core/src/game.ts`:

```ts
import {
  createTournament,
  endTournament,
  nextHandConfig,
  recordHand,
  type MenuConfig,
  type TournamentConfig,
  type TournamentState,
} from '@ab/engine'
import type { Player } from '@ab/players'
import { playHand } from './runner'
import type { EventStore } from './store'

export interface TournamentGameOptions {
  gameId: string
  /** Players in seat order. */
  players: Player[]
  tournament: TournamentConfig
  store: EventStore
  decisionTimeoutMs: number
  paceMs?: number
  /** Stop after the hand in which total spend reaches this (USD). */
  budgetUsd: number
  /** Extra config recorded (and hashed) with the game, e.g. the line-up spec. */
  meta?: Record<string, unknown>
  signal?: AbortSignal
  menu?: Partial<MenuConfig>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** Runs a live tournament to completion, recording everything in the store. */
export async function runTournamentGame(opts: TournamentGameOptions): Promise<TournamentState> {
  const players = new Map(opts.players.map((p) => [p.id, p]))
  opts.store.createGame(opts.gameId, 'live', {
    tournament: opts.tournament,
    players: opts.players.map((p) => ({ id: p.id, kind: p.kind, model: p.model })),
    decisionTimeoutMs: opts.decisionTimeoutMs,
    paceMs: opts.paceMs ?? 0,
    budgetUsd: opts.budgetUsd,
    ...opts.meta,
  })
  const sink = opts.store.sink(opts.gameId)
  sink.append({ type: 'game_started', kind: 'live', players: opts.players.map((p) => ({ id: p.id, kind: p.kind, model: p.model })) })

  let t = createTournament(
    opts.players.map((p) => p.id),
    opts.tournament,
  )
  while (!t.complete) {
    if (opts.signal?.aborted) {
      t = endTournament(t, 'interrupted')
      break
    }
    if (opts.store.gameCost(opts.gameId) >= opts.budgetUsd) {
      t = endTournament(t, 'budget_cap')
      break
    }
    const result = await playHand({
      config: nextHandConfig(t),
      players,
      sink,
      decisionTimeoutMs: opts.decisionTimeoutMs,
      ...(opts.paceMs !== undefined ? { paceMs: opts.paceMs } : {}),
      ...(opts.menu ? { menu: opts.menu } : {}),
      ...(opts.now ? { now: opts.now } : {}),
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
    })
    t = recordHand(t, result)
  }

  sink.append({
    type: 'game_ended',
    reason: t.endReason!,
    winner: t.winner,
    stacks: Object.fromEntries(t.players.map((p) => [p.id, p.stack])),
    eliminated: [...t.eliminated],
    handsPlayed: t.handNumber,
  })
  opts.store.setStatus(opts.gameId, t.endReason === 'interrupted' ? 'interrupted' : 'ended')
  return t
}
```

`packages/core/src/index.ts`:

```ts
export * from './events'
export * from './store'
export * from './runner'
export * from './game'
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @ab/core exec vitest run`
Expected: PASS (18 tests).

- [ ] **Step 5: Commit**


```bash
git add packages/core/src/game.ts packages/core/src/index.ts packages/core/test/game.test.ts
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(core): live tournament driver with budget cap and interruption" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```


---

### Task 11: `pnpm demo` and `pnpm smoke`

**Files:**
- Create: `packages/core/scripts/demo.ts`, `packages/core/scripts/smoke.ts`
- Create: `lineups/research.example.json`, `lineups/live.example.json`, `.env.example`
- Modify: root `package.json` (scripts, `tsx`), `.gitignore`

- [ ] **Step 1: Add the scripts**

`packages/core/scripts/demo.ts`:

```ts
/**
 * Free end-to-end demo: a full live turbo tournament with mock/bot players, written to SQLite.
 * Usage: pnpm demo [dbPath]
 */
import { liveTurboConfig } from '@ab/engine'
import { CallingStation, MockLlm, TagBot } from '@ab/players'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { runTournamentGame } from '../src/game'
import { EventStore } from '../src/store'

const dbPath = process.argv[2] ?? 'data/demo.db'
mkdirSync(dirname(dbPath), { recursive: true })
const store = new EventStore(dbPath)
const gameId = `demo-${Date.now()}`
const players = [new MockLlm('jev', 'mock/jev'), new TagBot('pill'), new MockLlm('block'), new CallingStation('drip'), new MockLlm('nimbus', 'mock/llm', { failEvery: 25 })]

const t = await runTournamentGame({ gameId, players, tournament: liveTurboConfig(gameId), store, decisionTimeoutMs: 2000, budgetUsd: 1 })
const events = store.events(gameId)
const decisions = events.filter((e) => e.type === 'decision')
console.log(`game ${gameId}: ${t.handNumber} hands, ${decisions.length} decisions, ${events.length} events -> ${dbPath}`)
console.log(`ended: ${t.endReason}, winner: ${t.winner}, eliminated: ${t.eliminated.join(', ') || 'none'}`)
const rows = store.db
  .prepare(
    `SELECT player_id AS player, model, COUNT(*) AS decisions, ROUND(AVG(latency_ms), 1) AS avg_ms,
            ROUND(SUM(cost_usd), 6) AS cost_usd, SUM(fallback) AS fallbacks
     FROM decisions WHERE game_id = ? GROUP BY player_id ORDER BY player_id`,
  )
  .all(gameId)
console.table(rows)
store.close()
```

`packages/core/scripts/smoke.ts`:

```ts
/**
 * Real-API smoke test: a short live tournament with the players in a line-up file.
 * Costs real money (capped by --budget). Keys come from .env (see .env.example).
 * Usage: pnpm smoke [lineups/live.json] [--hands 5] [--budget 0.25]
 * Line-ups: copy lineups/live.example.json or lineups/research.example.json and edit.
 */
import { liveTurboConfig } from '@ab/engine'
import { createPlayers, type PlayerSpec } from '@ab/players'
import { mkdirSync, readFileSync } from 'node:fs'
import { runTournamentGame } from '../src/game'
import { EventStore } from '../src/store'

const args = process.argv.slice(2)
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? Number(args[i + 1]) : fallback
}
const lineupPath = args.find((a) => a.endsWith('.json')) ?? 'lineups/live.json'
const hands = flag('hands', 5)
const budgetUsd = flag('budget', 0.25)

const lineup = JSON.parse(readFileSync(lineupPath, 'utf8')) as { players: PlayerSpec[] }
const players = createPlayers(lineup.players, process.env)
mkdirSync('data', { recursive: true })
const store = new EventStore('data/smoke.db')
const gameId = `smoke-${Date.now()}`
console.log(`smoke ${gameId}: ${players.map((p) => `${p.id}=${p.model}`).join(', ')}; ${hands} hands max, $${budgetUsd} cap`)

const t = await runTournamentGame({
  gameId,
  players,
  tournament: { ...liveTurboConfig(gameId), maxHands: hands },
  store,
  decisionTimeoutMs: 20_000,
  budgetUsd,
  meta: { lineup: lineup.players },
})
for (const e of store.events(gameId)) {
  if (e.type !== 'decision') continue
  const why = e.fallback ? `FALLBACK (${e.fallbackReason})` : (e.reasoning ?? '')
  console.log(
    `${e.handId} ${e.street.padEnd(7)} ${e.playerId.padEnd(7)} ${e.label.padEnd(18)} ${String(Math.round(e.latencyMs)).padStart(6)}ms $${e.costUsd.toFixed(5)} win=${e.winProbability ?? '-'} ${why}`,
  )
}
console.log(`ended: ${t.endReason} after ${t.handNumber} hands; total cost $${store.gameCost(gameId).toFixed(4)}`)
store.close()
```

Two line-ups (model ids current on OpenRouter as of 2026-09-21; see the cost note below). The user's filled-in copies (`lineups/*.json`) are git-ignored.

`lineups/research.example.json` (study and recorded games: the frontier models TypeSafe benchmarked Jev against):
```json
{
  "_note": "Research / recorded line-up: the frontier models TypeSafe benchmarked Jev against. About $1.30 per live game.",
  "players": [
    { "id": "jev", "kind": "jev", "model": "jev-1.13.0" },
    { "id": "pill", "kind": "llm", "model": "anthropic/claude-fable-5.1" },
    { "id": "block", "kind": "llm", "model": "openai/gpt-6-astra" },
    { "id": "drip", "kind": "llm", "model": "google/gemini-3.8-flash" },
    { "id": "nimbus", "kind": "llm", "model": "meta-llama/llama-4-maverick", "disableReasoning": false }
  ]
}
```

`lineups/live.example.json` (everyday live games, cheaper):
```json
{
  "_note": "Everyday live line-up: cheaper models for normal spectator games. About $0.32 per live game.",
  "players": [
    { "id": "jev", "kind": "jev", "model": "jev-1.13.0" },
    { "id": "pill", "kind": "llm", "model": "anthropic/claude-sonnet-5" },
    { "id": "block", "kind": "llm", "model": "openai/gpt-5.6-sol" },
    { "id": "drip", "kind": "llm", "model": "google/gemini-3.8-flash" },
    { "id": "nimbus", "kind": "llm", "model": "meta-llama/llama-4-maverick", "disableReasoning": false }
  ]
}
```

`.env.example`:

```bash
# Copy to .env (git-ignored) and fill in. Never commit real keys.
OPENROUTER_API_KEY=
TYPESAFE_API_KEY=
```

In the root `package.json`, add to `scripts`:
```json
    "demo": "tsx packages/core/scripts/demo.ts",
    "smoke": "tsx --env-file=.env packages/core/scripts/smoke.ts"
```
and to `devDependencies`: `"tsx": "^4.20.0"`. Append to `.gitignore`:
```
data/
lineups/*.json
!lineups/*.example.json
```
Run: `pnpm install`.

- [ ] **Step 2: Run the free demo**

Run: `pnpm demo`
Expected: prints one line like `game demo-…: 67 hands, 393 decisions, 1161 events -> data/demo.db`, the end reason and winner, and a table of decisions, average latency, cost and fallbacks per player (nimbus shows a few fallbacks from its injected failures). Exact numbers vary with the timestamp-based seed.

- [ ] **Step 3: Full verification**

Run: `pnpm test && pnpm typecheck`
Expected: engine 104, players 28, core 18 tests pass; typecheck clean across all three packages.

- [ ] **Step 4: Commit**


```bash
git add packages/core/scripts lineups .env.example package.json pnpm-lock.yaml .gitignore
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat: free demo and capped real-API smoke scripts" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```


- [ ] **Step 5 (user, optional, costs money): real smoke test**

Only with the user's go-ahead and keys: copy `.env.example` to `.env` and fill both keys; copy `lineups/live.example.json` to `lineups/live.json` (or the research line-up) and adjust models; run `pnpm smoke lineups/live.json --hands 5 --budget 0.25`. Expect a line per decision with latency, cost, stated win probability and reasoning or fallback reason, and a final total under the cap. Check: no unexpected fallbacks (a model rejecting `reasoning: {effort: "none"}` or lacking structured outputs shows up here; fix via `disableReasoning`/`structuredOutput` in the line-up).

---

## Cost note for the line-ups

Measured shape from the demo: about 6 decisions per hand and ~65 hands per live game, so ~390 decisions, ~310 of them by the four LLM seats. At ~500 input and ~60 output tokens per decision:

| Seat | Research line-up | $/game | Live line-up | $/game |
|---|---|---|---|---|
| JEV | jev-1.13.0 | 0.002 | jev-1.13.0 | 0.002 |
| PILL | anthropic/claude-fable-5.1 ($10/$50 per M) | 0.62 | anthropic/claude-sonnet-5 ($2/$10) | 0.13 |
| BLOCK | openai/gpt-6-astra ($10/$50) | 0.62 | openai/gpt-5.6-sol ($2/$10) | 0.13 |
| DRIP | google/gemini-3.8-flash ($0.75/$3.75) | 0.05 | same | 0.05 |
| NIMBUS | meta-llama/llama-4-maverick ($0.20/$0.80) | 0.01 | same | 0.01 |
| **Total** | | **≈ $1.30** | | **≈ $0.32** |

User decision (2026-09-21): the research line-up is used for the study and recorded games; everyday live games use the cheaper live line-up. Both are config files; the per-game budget cap enforces whatever is chosen.

## Done when

- `pnpm test` passes (engine 104, players 28, core 18) and `pnpm typecheck` is clean.
- `pnpm demo` plays a full mock tournament into `data/demo.db` with no errors.
- `@ab/players` exports `buildObservation`, the bots, `MockLlm`, `LlmPlayer`, `JevPlayer`, `createPlayers`; `@ab/core` exports the event types, `EventStore`, `playHand`, `runTournamentGame`.
- Next: Plan 3 (study runner: duplicate groups, budget cap, resume, CI stop, report) builds on `playHand`, `EventStore` and `duplicateGroup`.

