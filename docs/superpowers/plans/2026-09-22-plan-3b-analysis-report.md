# artificialBluff Plan 3b: Analysis and Report

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a study's event log into the published results: bb/100 with CIs and Holm-corrected paired contrasts (Jev vs each model), cost, latency, win-probability calibration (A: main-pot share won; C: expected main-pot share at the decision, exact enumeration), per-action calibration, fallback rates and play style, as a self-contained HTML report plus JSON/CSV exports. Ships `pnpm study report`.

**Architecture:** `@ab/engine` gains exact main-pot equity (`mainPotSharesBySubset`: one pass over the remaining boards scores every live-player subset of a deal). A new package `packages/analysis` (`@ab/analysis`) holds pure functions over the event log (hand and decision records, outcomes, calibration, player metrics) so Plan 4's `/research` page can reuse them. `apps/study` adds which hands count (the valid attempt of each rotation in the analysed groups), paired contrasts with Holm correction, the report model, CSV export, the HTML renderer (inline SVG, no scripts, Broadcast palette) and the `report` command.

**Tech Stack:** as before (TypeScript strict, Vitest, `phe` for hand values, `tsx` for the CLI). No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-21-artificialbluff-design.md` §5 (calibration A and C, confidence semantics), §6 (outputs, CIs, Holm), §8 (brand), §10 (statistics validated on synthetic data). Status/todos: `docs/STATUS.md`.

**Plan series:** 1 Engine → 2 Players, runner, event log → 3a Study runner (all merged) → **3b Analysis and report (this)** → 4 Live server and web.

---

## Notes for the implementer

- **Everything is free:** the report reads the SQLite event log only. No network, no keys. Never run `pnpm study run --live`.
- **Outcome A (headline calibration):** a decision's outcome is the player's share of the **main pot** (the first `pot_awarded` of the hand): 1 if they won it alone, 1/k if split k ways, 0 if they lost it or folded at **any** point in the hand. Side pots are ignored.
- **Outcome C (second chart):** the player's expected main-pot share at the moment of the decision, against the players still in the hand, by exact enumeration of every remaining board, given **every dealt hole card** (folded hands' cards are dead: they can't come on the board). Later actions and board luck don't count.
- **Speed:** preflop with 5 players is ~850,000 boards. Duplicate rotations deal the same cards, and every live set of a deal is a subset of its players, so `scoreDecisions` enumerates each (deal, board) once and scores all needed subsets in that pass, with a cache keyed by the deal in canonical (card) order. A 200-hand study analyses in ~12 s; vitest runs the engine slower than `tsx`, so the enumeration tests take a few seconds.
- **Per-action outcome:** folds and calls are scored by all-in equity (outcome C) against the pot odds of the pot the player could actually win, `toCall / (winnablePot + toCall)` (the same winnable pot the players were shown): a fold is right below them, a call at or above them. Checks and raises have no equity rule: they are right if the player's stack didn't shrink from just before the action to the end of the hand. Calibration of the stated `confidence` against this 0/1 outcome is reported **per action type only, never pooled** (the rules and base rates differ; pooling would reward passive play). (Review finding.)
- **Confidence is not one metric:** Jev's is derived from its option probabilities (TypeSafe's definition), the LLMs' is self-reported. The report labels each player's source and says to compare each player with itself.
- **Calibration metrics:** reliability curve with 10 equal-width bins (p = 1 goes in the top bin), Brier score (mean squared error; outcomes may be fractional), ECE (bin-size-weighted mean |mean stated − mean outcome|). Fallback decisions are excluded from calibration (they have no stated probabilities) and counted under fallbacks.
- **bb/100 and contrasts:** per-player 95% Student t CIs over neighbour blocks (from Plan 3a) plus the bootstrap sensitivity CI. Pairwise claims use the focus player (the first `jev` seat of the real config) minus each other player, per block, with a t CI, two-sided paired t test and Holm step-down adjustment; "significant" = Holm p < 0.05.
- **Which hands:** for each (group, rotation) in the analysed groups, the valid attempt (reached `hand_ended`, not cut off by the budget cap; the first such attempt). Analysed groups = `study_ended.analysedGroups` once the study has ended, else the completed prefix cut to whole blocks. Cost in the header is everything the study spent, including cut-off hands.
- **Play style:** VPIP (voluntary preflop call or raise), PFR (preflop raise), both over hands with a preflop decision (walks don't count), AF (postflop bets+raises ÷ calls; undefined with no calls), WTSD (showdowns ÷ hands seen to the flop). Bets are logged as raises (`currentBet` was 0).
- **Per-decision cost, tokens and latency** leave out auto-played decisions (a seat skipped after repeated failures is logged at 0 ms and $0, which would flatter a flaky model); timeouts count at the time limit. The headline fallback rate is model-output failures only (invalid, empty, refused, truncated); provider errors and timeouts are listed separately.
- **Hands are grouped by game and hand id**, so logs of several games can be analysed together.
- **HTML safety:** every string from the log or config is escaped; the page has no scripts, links or external requests. CSV text starting with `= + - @` gets a leading `'` so spreadsheets don't evaluate it.
- **Pre-registered analysis:** the record hashes the comparison family (first Jev seat minus each other seat, Holm over those n − 1; no other pairwise claims) and the per-action rules. The report reads the log once (one consistent snapshot) and, before `study_ended`, honours a logged `stop: true` checkpoint (a crash, or hands still finishing) rather than the growing prefix.
- **Readable numbers:** costs keep ≥ 3 significant digits (a Jev decision costs ~$0.0000084); p-values below 0.0001 show as `<0.0001` and are computed from the t tail directly. Mock seats and unfinished studies get a banner.

## File map

| File | Responsibility |
|---|---|
| `packages/engine/src/equity.ts` | `mainPotShares`, `mainPotSharesBySubset` (exact enumeration) |
| `packages/engine/src/phe.d.ts` (modify) | Types for `phe`'s `evaluateCardCodes` and `cardCode` |
| `packages/analysis/src/hands.ts` | `extractHands`: hand and decision records, outcome A; `playerInfo` |
| `packages/analysis/src/outcomes.ts` | `scoreDecisions`: outcome C and the per-action score |
| `packages/analysis/src/calibration.ts` | Reliability bins, Brier, ECE |
| `packages/analysis/src/metrics.ts` | `quantile`, `playerMetrics` (cost, latency, fallbacks, play style) |
| `apps/study/src/progress.ts`, `run.ts` (modify) | Remember the hand id of each valid attempt |
| `apps/study/src/results.ts` (modify) | `blockValues` (shared by summaries and contrasts) |
| `apps/study/src/contrasts.ts` | Paired contrasts, t test, Holm |
| `apps/study/src/report.ts` | `studyHands`, `analyseStudy` → `StudyReport` |
| `apps/study/src/exports.ts` | `decisionsCsv` |
| `apps/study/src/html.ts` | `renderReportHtml` |
| `apps/study/src/commands.ts`, `cli.ts` (modify) | `pnpm study report <config> [--mock] [--db] [--out]` |

---

### Task 1: Exact main-pot equity in the engine

**Files:**
- Create: `packages/engine/src/equity.ts`
- Modify: `packages/engine/src/phe.d.ts`, `packages/engine/src/index.ts`
- Test: `packages/engine/test/equity.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/equity.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { Card } from '../src/cards'
import { mainPotShares, mainPotSharesBySubset } from '../src/equity'
import { evaluateHand } from '../src/evaluate'

const cards = (s: string) => (s ? (s.split(' ') as Card[]) : [])

/** Brute force with the engine's own evaluator: the reference for small enumerations. */
function bruteForce(holes: Card[][], board: Card[], deck: Card[]): number[] {
  const shares = holes.map(() => 0)
  let boards = 0
  const rec = (from: number, b: Card[]) => {
    if (b.length === 5) {
      boards++
      const v = holes.map((h) => evaluateHand([...h, ...b]).value)
      const best = Math.min(...v)
      const k = v.filter((x) => x === best).length
      v.forEach((x, i) => {
        if (x === best) shares[i]! += 1 / k
      })
      return
    }
    for (let i = from; i < deck.length; i++) rec(i + 1, [...b, deck[i]!])
  }
  rec(0, board)
  return shares.map((s) => s / boards)
}

describe('mainPotShares', () => {
  it('matches the known preflop equity of AA vs KK with matching suits', () => {
    // 82.64%: the best case for AA (KK's flushes are dominated). Checked by brute force over all 1,712,304 boards.
    const [aa, kk] = mainPotShares([cards('Ah As'), cards('Kh Ks')], [])
    expect(aa).toBeCloseTo(0.826366, 6)
    expect(kk).toBeCloseTo(0.173634, 6)
  })

  it('splits ties and is exact on the river', () => {
    expect(mainPotShares([cards('2c 3d'), cards('2d 3c')], cards('As Ks Qs Js Ts'))).toEqual([0.5, 0.5])
    expect(mainPotShares([cards('Ac Ad'), cards('Kc Kd'), cards('7h 2s')], cards('Ah Kh 9c 5d 3s'))).toEqual([1, 0, 0])
  })

  it('agrees with brute force on the flop and turn, three ways', () => {
    const holes = [cards('Ah Kh'), cards('Qd Qc'), cards('9h 8h')]
    for (const board of [cards('Jh Tc 2h'), cards('Jh Tc 2h 7d')]) {
      const used = new Set([...holes.flat(), ...board])
      const deck = (['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const)
        .flatMap((r) => (['s', 'h', 'd', 'c'] as const).map((s) => `${r}${s}` as Card))
        .filter((c) => !used.has(c))
      const exact = mainPotShares(holes, board)
      bruteForce(holes, board, deck).forEach((v, i) => expect(exact[i]).toBeCloseTo(v, 12))
      expect(exact.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
    }
  })

  it('handles five players preflop and sums to 1', () => {
    const shares = mainPotShares([cards('As Kd'), cards('Qh Qc'), cards('7s 6s'), cards('2d 2h'), cards('Jc Tc')], [])
    expect(shares.map((s) => Number(s.toFixed(4)))).toEqual([0.2248, 0.2596, 0.2033, 0.1379, 0.1744])
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
  })

  it('rejects bad input', () => {
    expect(() => mainPotShares([cards('Ah As')], [])).toThrow(/at least two/)
    expect(() => mainPotShares([cards('Ah As'), cards('Ah Ks')], [])).toThrow(/duplicate/)
    expect(() => mainPotShares([cards('Ah As'), cards('Kh Ks')], cards('2c 3c'))).toThrow(/0, 3, 4 or 5/)
    expect(() => mainPotShares([cards('Ah Xs'), cards('Kh Ks')], [])).toThrow(/malformed/)
    expect(() => mainPotShares([cards('Ah'), cards('Kh Ks')], [])).toThrow(/two hole cards/)
  })

  it('scores several subsets in one pass, with every dealt hole card dead', () => {
    const holes = [cards('As Kd'), cards('Qh Qc'), cards('7s 6s'), cards('2d 2h')]
    const board = cards('Jh Tc 2s')
    const subsets = [[0, 1, 2, 3], [0, 2], [3, 1, 0]]
    const batch = mainPotSharesBySubset(holes, board, subsets)
    const dead = new Set([...holes.flat(), ...board])
    const deck = (['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const)
      .flatMap((r) => (['s', 'h', 'd', 'c'] as const).map((s) => `${r}${s}` as Card))
      .filter((c) => !dead.has(c))
    subsets.forEach((sub, k) => {
      // Brute force over the same live deck: the folded players' cards (outside the subset) can't come.
      bruteForce(sub.map((i) => holes[i]!), board, deck).forEach((v, j) => expect(batch[k]![j]).toBeCloseTo(v, 12))
    })
    expect(batch[0]).toEqual(mainPotShares(holes, board))
    expect(() => mainPotSharesBySubset(holes, board, [[0]])).toThrow(/at least two/)
    expect(() => mainPotSharesBySubset(holes, board, [[0, 0]])).toThrow(/bad subset/)
    expect(() => mainPotSharesBySubset(holes, board, [[0, 9]])).toThrow(/bad subset/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/engine exec vitest run test/equity.test.ts`
Expected: FAIL (cannot resolve `../src/equity`).

- [ ] **Step 3: Implement**

Replace `packages/engine/src/phe.d.ts` with:
```ts
declare module 'phe' {
  /** 1 = royal flush (best) … 7462 = 7-high (worst). */
  export function evaluateCards(cards: string[]): number
  /** Same scale as evaluateCards, from 5-7 card codes (0-51, see cardCode). */
  export function evaluateCardCodes(codes: number[]): number
  /** Card code 0-51 from a rank ('2'…'A') and a suit ('s', 'h', 'd', 'c'). */
  export function cardCode(rank: string, suit: string): number
  /** 0 = straight flush … 8 = high card. */
  export function handRank(value: number): number
  export const rankDescription: string[]
}
```

`packages/engine/src/equity.ts`:
```ts
/// <reference path="./phe.d.ts" />
import { cardCode, evaluateCardCodes } from 'phe'
import { fullDeck, isCard, type Card } from './cards'

/**
 * Each player's expected share of the main pot if nobody folds from here: exact enumeration of every
 * remaining board, splitting ties equally. `holes[i]` are player i's two hole cards; `board` has 0, 3,
 * 4 or 5 cards. The main pot is contested by every player still in the hand, so this is each player's
 * share of it at showdown, averaged over the boards still possible. Shares sum to 1.
 *
 * Cost: preflop with 5 players is ~850,000 boards (about 0.2 s); later streets are instant.
 */
export function mainPotShares(holes: readonly (readonly Card[])[], board: readonly Card[]): number[] {
  return mainPotSharesBySubset(holes, board, [holes.map((_, i) => i)])[0]!
}

/**
 * mainPotShares for several subsets of the same players (e.g. who was still in the hand at each
 * decision of a deal) in one pass over the boards. `subsets[k]` lists indices into `holes` (at least
 * two each); result `[k][j]` is the share of player `subsets[k][j]`. Every player's hole cards are
 * dead, including those outside a subset (a folded hand's cards can't come on the board), so this is
 * the exact equity given every dealt card. Enumerating the boards once is what makes exact preflop
 * equity affordable for a whole study.
 */
export function mainPotSharesBySubset(
  holes: readonly (readonly Card[])[],
  board: readonly Card[],
  subsets: readonly (readonly number[])[],
): number[][] {
  if (holes.length < 2) throw new Error('mainPotShares needs at least two players')
  if (![0, 3, 4, 5].includes(board.length)) throw new Error(`mainPotShares: a board has 0, 3, 4 or 5 cards, got ${board.length}`)
  for (const h of holes) if (h.length !== 2) throw new Error('mainPotShares: every player needs two hole cards')
  const known = [...holes.flat(), ...board]
  const bad = known.find((c) => !isCard(c))
  if (bad !== undefined) throw new Error(`mainPotShares got a malformed card: ${bad}`)
  if (new Set(known).size !== known.length) throw new Error(`mainPotShares got duplicate cards: ${known.join(' ')}`)
  for (const sub of subsets) {
    if (sub.length < 2) throw new Error('mainPotShares: every subset needs at least two players')
    if (new Set(sub).size !== sub.length || sub.some((i) => !Number.isInteger(i) || i < 0 || i >= holes.length)) {
      throw new Error(`mainPotShares: bad subset ${sub.join(',')}`)
    }
  }

  const code = (c: Card) => cardCode(c[0]!, c[1]!)
  const holeCodes = holes.map((h) => h.map(code))
  const used = new Set(known)
  const rest = fullDeck().filter((c) => !used.has(c)).map(code)
  const missing = 5 - board.length
  const n = holes.length
  const needed = [...new Set(subsets.flat())]
  const shares = subsets.map((sub) => new Array<number>(sub.length).fill(0))
  const values = new Array<number>(n).fill(0)
  const cards = new Array<number>(7).fill(0)
  board.forEach((c, i) => (cards[i] = code(c)))
  let boards = 0

  const score = () => {
    boards++
    for (const p of needed) {
      cards[5] = holeCodes[p]![0]!
      cards[6] = holeCodes[p]![1]!
      values[p] = evaluateCardCodes(cards)
    }
    for (let k = 0; k < subsets.length; k++) {
      const sub = subsets[k]!
      let best = Infinity
      let tied = 0
      for (const p of sub) {
        const v = values[p]!
        if (v < best) {
          best = v
          tied = 1
        } else if (v === best) tied++
      }
      const out = shares[k]!
      for (let j = 0; j < sub.length; j++) if (values[sub[j]!] === best) out[j]! += 1 / tied
    }
  }
  // Choose the missing cards from the rest of the deck, in increasing index order.
  const pick = (from: number, slot: number) => {
    if (slot === 5) return score()
    for (let i = from; i <= rest.length - (5 - slot); i++) {
      cards[slot] = rest[i]!
      pick(i + 1, slot + 1)
    }
  }
  pick(0, 5 - missing)
  return shares.map((row) => row.map((s) => s / boards))
}
```

Append to `packages/engine/src/index.ts`:
```ts
export * from './equity'
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/engine exec vitest run && pnpm --filter @ab/engine typecheck`
Expected: PASS (110 tests; the two preflop enumerations take a few seconds under vitest); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(engine): exact main-pot equity by enumeration, batched over live subsets" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Analysis package and hand records (outcome A)

**Files:**
- Create: `packages/analysis/package.json`, `packages/analysis/tsconfig.json`, `packages/analysis/src/hands.ts`, `packages/analysis/src/index.ts`
- Test: `packages/analysis/test/helpers.ts`, `packages/analysis/test/hands.test.ts`

- [ ] **Step 1: Create the package and write the failing test**

`packages/analysis/package.json`:
```json
{
  "name": "@ab/analysis",
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
    "@ab/core": "workspace:*",
    "@ab/engine": "workspace:*"
  },
  "devDependencies": {
    "@ab/players": "workspace:*"
  }
}
```

`packages/analysis/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Then run `pnpm install` (links the workspace package; no downloads).

`packages/analysis/test/helpers.ts` (test helpers: in-memory sink, fixed deals, scripted players):
```ts
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
```

`packages/analysis/test/hands.test.ts`:
```ts
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
      { type: 'game_started', kind: 'study', configHash: 'h', players: [{ id: 'jev', kind: 'jev', model: 'jev-1.13.0' }], gameId: 'g', seq: 1, ts: 0 },
    ])
    expect(info.get('jev')).toEqual({ id: 'jev', kind: 'jev', model: 'jev-1.13.0' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/analysis exec vitest run`
Expected: FAIL (cannot resolve `../src/hands`).

- [ ] **Step 3: Implement**

`packages/analysis/src/hands.ts`:
```ts
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
  /**
   * The part of the pot this player can win: every seat's chips up to what this player will have in
   * after calling (the excess goes back to its owner). Pot odds use it, as the players were shown.
   */
  winnablePot: number
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
 * with parallel tables; events of several games are kept apart by game id). Hands without an id, or
 * that never reached hand_ended, are skipped.
 */
export function extractHands(events: readonly GameEvent[]): HandRecord[] {
  const byHand = new Map<string, { handId: string; events: HandEvent[] }>()
  for (const e of events) {
    if (!('handId' in e) || e.handId === null) continue
    const key = `${e.gameId}\u0000${e.handId}`
    const entry = byHand.get(key)
    if (entry) entry.events.push(e)
    else byHand.set(key, { handId: e.handId, events: [e] })
  }
  const hands: HandRecord[] = []
  for (const { handId, events: list } of byHand.values()) {
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
  const startStacks = new Map(started.seats.map((s) => [s.playerId, s.stack]))
  const stacks = new Map(startStacks)
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
      const committed = (id: string) => startStacks.get(id)! - stacks.get(id)!
      const reach = committed(e.playerId) + e.toCall
      const winnablePot = order.reduce((sum, id) => sum + Math.min(committed(id), reach), 0)
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
        winnablePot,
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
```

`packages/analysis/src/index.ts`:
```ts
export * from './hands'
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/analysis exec vitest run && pnpm --filter @ab/analysis typecheck`
Expected: PASS (7 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/analysis pnpm-lock.yaml
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(analysis): hand and decision records from the event log, outcome A" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Outcome C and the per-action score

**Files:**
- Create: `packages/analysis/src/outcomes.ts`
- Modify: `packages/analysis/src/index.ts`
- Test: `packages/analysis/test/outcomes.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/analysis/test/outcomes.test.ts`:
```ts
import { mainPotShares, mainPotSharesBySubset, type Card } from '@ab/engine'
import { describe, expect, it } from 'vitest'
import { extractHands, type DecisionRecord } from '../src/hands'
import { actionGood, scoreDecisions, type ShareCache } from '../src/outcomes'
import { playFixedHand, scripted } from './helpers'

const caller = (id: string) => scripted(id, () => undefined)
const board = ['2c', '7d', '9h', 'Js', '4c']
const cards = (s: string) => s.split(' ') as Card[]

describe('outcome C: expected main-pot share at the decision', () => {
  it('is the exact all-in equity of the live players, and 0 or 1 once the river is out', async () => {
    const [hand] = extractHands(await playFixedHand([caller('a'), caller('b'), caller('c')], [['Ah', 'Ad'], ['Kh', 'Kd'], ['Qh', 'Qd']], board))
    const scored = scoreDecisions([hand!])
    const preflopA = scored[0]!
    expect(preflopA.expectedShare).toBeCloseTo(mainPotShares([cards('Ah Ad'), cards('Kh Kd'), cards('Qh Qd')], [])[0]!, 12)
    for (const d of scored.filter((x) => x.street === 'river')) expect(d.expectedShare).toBe(d.playerId === 'a' ? 1 : 0)
  })

  it('reuses one enumeration for the same cards in different seats', async () => {
    const cache: ShareCache = new Map()
    const [h1] = extractHands(await playFixedHand([caller('a'), caller('b')], [['Ah', 'Ad'], ['Kh', 'Kd']], board, 'h1'))
    const [h2] = extractHands(await playFixedHand([caller('a'), caller('b')], [['Kh', 'Kd'], ['Ah', 'Ad']], board, 'h2'))
    const first = scoreDecisions([h1!], cache)[0]!.expectedShare
    const size = cache.size
    const mirrored = scoreDecisions([h2!], cache)[0]!.expectedShare // a now holds the kings
    expect(cache.size).toBe(size)
    expect(first + mirrored).toBeCloseTo(1, 12)
  })

  it('scores two live sets of one deal and board in the same pass', async () => {
    // a opens, b folds, c calls: preflop decisions see {a, b, c} and then {a, c}.
    const opener = scripted('a', (o) => (o.street === 'preflop' ? 'open_3bb' : undefined))
    const folder = scripted('b', () => 'fold')
    const [hand] = extractHands(await playFixedHand([opener, folder, caller('c')], [['Ah', 'Kd'], ['Qh', 'Qd'], ['7s', '6s']], board))
    const holes = [cards('Ah Kd'), cards('Qh Qd'), cards('7s 6s')]
    const [all, headsUp] = mainPotSharesBySubset(holes, [], [[0, 1, 2], [0, 2]])
    const scored = scoreDecisions([hand!])
    const pre = scored.filter((d) => d.street === 'preflop')
    expect(pre.map((d) => [d.playerId, d.live.length])).toEqual([
      ['a', 3],
      ['b', 3],
      ['c', 2],
    ])
    expect(pre[0]!.expectedShare).toBeCloseTo(all![0]!, 12)
    expect(pre[1]!.expectedShare).toBeCloseTo(all![1]!, 12)
    expect(pre[2]!.expectedShare).toBeCloseTo(headsUp![1]!, 12)
  })

  it("treats a folded player's cards as dead", async () => {
    // a (button, facing the big blind) folds two aces; b's later equity must not count on an ace coming.
    const folder = scripted('a', () => 'fold')
    const [hand] = extractHands(await playFixedHand([folder, caller('b'), caller('c')], [['As', 'Ac'], ['Ah', 'Kd'], ['Qh', 'Qd']], board))
    expect(hand!.folded).toEqual(['a'])
    const flopB = scoreDecisions([hand!]).find((d) => d.street === 'flop' && d.playerId === 'b')!
    const holes = [cards('As Ac'), cards('Ah Kd'), cards('Qh Qd')]
    expect(flopB.expectedShare).toBeCloseTo(mainPotSharesBySubset(holes, cards('2c 7d 9h'), [[1, 2]])[0]![0]!, 12)
    // Leaving the folded aces in the deck would overstate b's chances.
    expect(mainPotShares(holes.slice(1), cards('2c 7d 9h'))[0]!).toBeGreaterThan(flopB.expectedShare + 0.01)
  })
})

describe('per-action outcome', () => {
  it('scores a fold by all-in equity against the pot odds, other actions by the chips that followed', async () => {
    // b folds a weak hand to a flop bet (right, by equity); c calls the flop bet with kings behind aces
    // (wrong, by equity). Checks are scored by the chips that followed: c's preflop and flop checks led
    // to chips lost, its turn and river checks cost nothing more.
    const bettor = scripted('a', (o) => (o.street === 'flop' ? 'pot_50' : undefined))
    const folder = scripted('b', (o) => (o.street === 'flop' ? 'fold' : undefined))
    const [hand] = extractHands(await playFixedHand([bettor, folder, caller('c')], [['Ah', 'Ad'], ['3h', '8d'], ['Kh', 'Kd']], board))
    const scored = scoreDecisions([hand!])
    const fold = scored.find((d) => d.actionType === 'fold')!
    expect(fold.expectedShare).toBeLessThan(fold.toCall / (fold.winnablePot + fold.toCall))
    expect(fold.actionGood).toBe(1)
    expect(scored.filter((d) => d.playerId === 'c').map((d) => [d.street, d.actionType, d.actionGood])).toEqual([
      ['preflop', 'check', 0],
      ['flop', 'check', 0],
      ['flop', 'call', 0],
      ['turn', 'check', 1],
      ['river', 'check', 1],
    ])
    expect(scored.filter((d) => d.playerId === 'a').every((d) => d.actionGood === 1)).toBe(true)
    // The same fold with the aces instead would have been wrong.
    expect(actionGood(fold, 0.9)).toBe(0)
  })

  it('scores calls by equity too, and uses the pot the player can actually win', () => {
    const base = scoreDecisionsStub()
    // Facing a 950 all-in call with only 1,150 winnable (a short stack), 30% equity is not enough to call...
    const shortCall = { ...base, actionType: 'call' as const, toCall: 950, pot: 10_150, winnablePot: 1_150 }
    expect(actionGood(shortCall, 0.3)).toBe(0) // pot odds 950 / 2,100 = 45%
    expect(actionGood(shortCall, 0.5)).toBe(1)
    // ...and folding it is right, although the raw pot (10,150) would suggest 9% odds.
    expect(actionGood({ ...shortCall, actionType: 'fold' }, 0.3)).toBe(1)
  })
})

/** A minimal decision record for scoring rules (only the fields actionGood reads matter). */
function scoreDecisionsStub(): DecisionRecord {
  return {
    handId: 'x', index: 0, playerId: 'p', street: 'preflop', position: 'SB', model: 'm', optionId: 'call', actionType: 'call',
    chipsIn: 0, pot: 0, winnablePot: 0, toCall: 0, stackBefore: 0, board: [], live: ['p', 'q'], winProbability: null, confidence: null,
    optionProbabilities: null, latencyMs: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, retries: 0,
    fallback: false, fallbackKind: null, mainPotShare: 0, stackChange: 0,
  }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/analysis exec vitest run test/outcomes.test.ts`
Expected: FAIL (cannot resolve `../src/outcomes`).

- [ ] **Step 3: Implement**

`packages/analysis/src/outcomes.ts`:
```ts
import { mainPotSharesBySubset, type Card } from '@ab/engine'
import type { DecisionRecord, HandRecord } from './hands'

/** A decision with its outcome C and its per-action score. */
export interface ScoredDecision extends DecisionRecord {
  /**
   * Calibration outcome C: the player's expected share of the main pot at the moment of the decision,
   * against the players still in the hand, by exact enumeration of the remaining board given every
   * dealt hole card (folded hands' cards are dead). Later actions and board luck don't count.
   */
  expectedShare: number
  /**
   * Per-action outcome: 1 if the action was right, else 0. Folds and calls are scored by all-in equity
   * (outcome C) against the pot odds toCall / (winnablePot + toCall): a fold was right below them, a
   * call at or above them. Checks and raises have no such rule; they count as right if the player's
   * stack did not shrink from just before the action to the end of the hand, so later streets feed
   * into their score. Only ever compare this within one action type.
   */
  actionGood: 0 | 1
}

/**
 * Memo of main-pot shares, keyed by deal (every hole card, in canonical order), board and live
 * subset. Duplicate rotations deal the same cards, so they share entries.
 */
export type ShareCache = Map<string, number[]>

interface Canonical {
  /** Seat ids in canonical (card) order. */
  ids: string[]
  holes: Card[][]
  dealKey: string
}

function canonical(hand: HandRecord): Canonical {
  const players = hand.seats.map((s) => {
    const hole = hand.holes[s.playerId]
    if (!hole) throw new Error(`hand ${hand.handId}: no hole cards for ${s.playerId}`)
    return { id: s.playerId, hole, cards: hole.join('') }
  })
  // Same cards in different seats (duplicate rotations) give the same order and key.
  players.sort((a, b) => (a.cards < b.cards ? -1 : a.cards > b.cards ? 1 : 0))
  return { ids: players.map((p) => p.id), holes: players.map((p) => p.hole), dealKey: players.map((p) => p.cards).join('|') }
}

/** Indices (canonical order, ascending) of the decision's live players, and the cache key for them. */
function subsetOf(c: Canonical, d: DecisionRecord): { subset: number[]; key: string } {
  const subset = d.live.map((id) => c.ids.indexOf(id)).sort((a, b) => a - b)
  return { subset, key: `${c.dealKey}/${d.board.join('')}#${subset.join(',')}` }
}

/** Per-action outcome (see ScoredDecision.actionGood). */
export function actionGood(d: DecisionRecord, share: number): 0 | 1 {
  const potOdds = d.toCall / (d.winnablePot + d.toCall)
  if (d.actionType === 'fold') return share < potOdds ? 1 : 0
  if (d.actionType === 'call') return share >= potOdds ? 1 : 0
  return d.stackChange >= 0 ? 1 : 0
}

/**
 * Every decision of every hand, with outcome C and the per-action score. All live-player subsets
 * needed for one deal and board are enumerated in a single pass.
 */
export function scoreDecisions(hands: readonly HandRecord[], cache: ShareCache = new Map()): ScoredDecision[] {
  const canon = new Map(hands.map((h) => [h, canonical(h)]))
  const pending = new Map<string, { holes: Card[][]; board: Card[]; subsets: Map<string, number[]> }>()
  for (const hand of hands) {
    const c = canon.get(hand)!
    for (const d of hand.decisions) {
      const { subset, key } = subsetOf(c, d)
      if (cache.has(key)) continue
      const base = `${c.dealKey}/${d.board.join('')}`
      let job = pending.get(base)
      if (!job) pending.set(base, (job = { holes: c.holes, board: d.board, subsets: new Map() }))
      job.subsets.set(key, subset)
    }
  }
  for (const job of pending.values()) {
    const keys = [...job.subsets.keys()]
    const results = mainPotSharesBySubset(job.holes, job.board, [...job.subsets.values()])
    keys.forEach((k, i) => cache.set(k, results[i]!))
  }
  const out: ScoredDecision[] = []
  for (const hand of hands) {
    const c = canon.get(hand)!
    for (const d of hand.decisions) {
      const { subset, key } = subsetOf(c, d)
      const share = cache.get(key)![subset.indexOf(c.ids.indexOf(d.playerId))]!
      out.push({ ...d, expectedShare: share, actionGood: actionGood(d, share) })
    }
  }
  return out
}
```

`packages/analysis/src/index.ts` becomes:
```ts
export * from './hands'
export * from './outcomes'
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/analysis exec vitest run && pnpm --filter @ab/analysis typecheck`
Expected: PASS (13 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/analysis
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(analysis): outcome C (exact expected main-pot share) and per-action score" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Calibration metrics and player metrics

**Files:**
- Create: `packages/analysis/src/calibration.ts`, `packages/analysis/src/metrics.ts`
- Modify: `packages/analysis/src/index.ts`
- Test: `packages/analysis/test/calibration.test.ts`, `packages/analysis/test/metrics.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/analysis/test/calibration.test.ts` (synthetic data with known answers: a perfectly calibrated player and an overconfident one):
```ts
import { describe, expect, it } from 'vitest'
import { calibration, type CalibrationPoint } from '../src/calibration'

/** mulberry32: small seeded RNG for synthetic data. */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('calibration', () => {
  it('finds a perfectly calibrated fake player calibrated', () => {
    const r = rng(1)
    const points: CalibrationPoint[] = Array.from({ length: 50_000 }, () => {
      const p = r()
      return { p, o: r() < p ? 1 : 0 }
    })
    const c = calibration(points)
    expect(c.n).toBe(50_000)
    expect(c.ece!).toBeLessThan(0.01)
    expect(c.brier!).toBeCloseTo(1 / 6, 2) // E[p(1 - p)] for p ~ U(0, 1)
    for (const b of c.bins) expect(Math.abs(b.meanPredicted! - b.meanObserved!)).toBeLessThan(0.03)
  })

  it('measures an overconfident player exactly', () => {
    // Says 0.9 every time, is right 6 times in 10.
    const points = Array.from({ length: 10 }, (_, i) => ({ p: 0.9, o: i < 6 ? 1 : 0 }))
    const c = calibration(points)
    expect(c.ece).toBeCloseTo(0.3, 12)
    expect(c.brier).toBeCloseTo((6 * 0.01 + 4 * 0.81) / 10, 12)
    expect(c.bins[9]).toMatchObject({ n: 10, low: 0.9, high: 1 })
    expect(c.bins[9]!.meanPredicted).toBeCloseTo(0.9, 12)
    expect(c.bins[9]!.meanObserved).toBeCloseTo(0.6, 12)
    expect(c.bins[0]).toMatchObject({ n: 0, meanPredicted: null, meanObserved: null })
  })

  it('accepts fractional outcomes, puts p = 1 in the top bin, and validates input', () => {
    const c = calibration([
      { p: 1, o: 0.5 },
      { p: 0, o: 0 },
    ])
    expect(c.bins[9]!.n).toBe(1)
    expect(c.brier).toBeCloseTo(0.125, 12)
    expect(calibration([])).toMatchObject({ n: 0, brier: null, ece: null })
    expect(() => calibration([{ p: 1.2, o: 0 }])).toThrow(/\[0, 1\]/)
    expect(() => calibration([{ p: 0.5, o: Number.NaN }])).toThrow(/\[0, 1\]/)
    expect(() => calibration([], 0)).toThrow(/binCount/)
  })
})
```

`packages/analysis/test/metrics.test.ts`:
```ts
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ab/analysis exec vitest run test/calibration.test.ts test/metrics.test.ts`
Expected: FAIL (cannot resolve `../src/calibration`, `../src/metrics`).

- [ ] **Step 3: Implement**

`packages/analysis/src/calibration.ts`:
```ts
export interface CalibrationPoint {
  /** Stated probability. */
  p: number
  /** Outcome in [0, 1] (a fraction for split pots or expected shares). */
  o: number
}

export interface ReliabilityBin {
  low: number
  high: number
  n: number
  /** null when the bin is empty. */
  meanPredicted: number | null
  meanObserved: number | null
}

export interface Calibration {
  n: number
  /** Mean squared error between stated probability and outcome; null with no points. */
  brier: number | null
  /** Expected calibration error: bin-size-weighted mean |mean predicted - mean observed|; null with no points. */
  ece: number | null
  bins: ReliabilityBin[]
}

/** Reliability curve (equal-width bins), Brier score and ECE. */
export function calibration(points: readonly CalibrationPoint[], binCount = 10): Calibration {
  if (!Number.isInteger(binCount) || binCount < 1) throw new Error('calibration: binCount must be a positive integer')
  for (const { p, o } of points) {
    if (!(p >= 0 && p <= 1) || !(o >= 0 && o <= 1)) throw new Error(`calibration: probabilities and outcomes must be in [0, 1], got p=${p}, o=${o}`)
  }
  const sums = Array.from({ length: binCount }, () => ({ n: 0, p: 0, o: 0 }))
  let squared = 0
  for (const { p, o } of points) {
    const b = sums[Math.min(Math.floor(p * binCount), binCount - 1)]!
    b.n++
    b.p += p
    b.o += o
    squared += (p - o) ** 2
  }
  const n = points.length
  const bins = sums.map((b, i) => ({
    low: i / binCount,
    high: (i + 1) / binCount,
    n: b.n,
    meanPredicted: b.n ? b.p / b.n : null,
    meanObserved: b.n ? b.o / b.n : null,
  }))
  const ece = n ? sums.reduce((acc, b) => acc + (b.n ? Math.abs(b.p / b.n - b.o / b.n) * b.n : 0), 0) / n : null
  return { n, brier: n ? squared / n : null, ece, bins }
}
```

`packages/analysis/src/metrics.ts`:
```ts
import type { FallbackKind } from '@ab/core'
import type { HandRecord } from './hands'

/** Linear-interpolation quantile (R type 7); null for no values. */
export function quantile(values: readonly number[], q: number): number | null {
  if (!(q >= 0 && q <= 1)) throw new Error('quantile: q must be in [0, 1]')
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const h = (sorted.length - 1) * q
  const lo = Math.floor(h)
  const hi = Math.ceil(h)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (h - lo)
}

export interface PlayStyle {
  /** Share of hands the player voluntarily put chips in preflop (call or raise); walks don't count. */
  vpip: number | null
  /** Share of hands the player raised preflop; walks don't count. */
  pfr: number | null
  /** Aggression factor: postflop bets and raises per postflop call. */
  af: number | null
  /** Went to showdown: share of hands seen to the flop that reached showdown. */
  wtsd: number | null
}

export interface PlayerMetrics {
  playerId: string
  hands: number
  decisions: number
  costUsd: number
  costPerDecisionUsd: number | null
  costPer100HandsUsd: number | null
  meanInputTokens: number | null
  meanOutputTokens: number | null
  meanReasoningTokens: number | null
  /**
   * Latency, tokens and cost per decision are over answered decisions: auto-played ones (the seat was
   * skipped after repeated failures, logged at 0 ms and $0) are left out. Timeouts count at the limit.
   */
  latencyP50Ms: number | null
  latencyP95Ms: number | null
  latencyMeanMs: number | null
  fallbacks: Record<FallbackKind, number>
  /** Share of decisions that fell back to check/fold, any kind. */
  fallbackRate: number | null
  /** Share of decisions that fell back because of the model's own output (invalid, empty, refused, truncated). */
  modelFallbackRate: number | null
  /** Share of decisions that needed a retry. */
  retryRate: number | null
  style: PlayStyle
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null)
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

/** Cost, latency, reliability and play style of one player over the given hands. */
export function playerMetrics(hands: readonly HandRecord[], playerId: string): PlayerMetrics {
  const seated = hands.filter((h) => h.seats.some((s) => s.playerId === playerId))
  const decisions = seated.flatMap((h) => h.decisions.filter((d) => d.playerId === playerId))
  const answered = decisions.filter((d) => d.fallbackKind !== 'auto')
  const costUsd = decisions.reduce((s, d) => s + d.costUsd, 0)
  const fallbacks: Record<FallbackKind, number> = { model: 0, infra: 0, timeout: 0, auto: 0 }
  for (const d of decisions) if (d.fallbackKind) fallbacks[d.fallbackKind]++

  let preflopHands = 0
  let vpip = 0
  let pfr = 0
  let aggressive = 0
  let calls = 0
  let sawFlop = 0
  let showdowns = 0
  for (const h of seated) {
    const mine = h.decisions.filter((d) => d.playerId === playerId)
    const pre = mine.filter((d) => d.street === 'preflop')
    if (pre.length) preflopHands++ // a walk (no preflop decision) is not a chance to play
    if (pre.some((d) => d.actionType === 'call' || d.actionType === 'raise')) vpip++
    if (pre.some((d) => d.actionType === 'raise')) pfr++
    for (const d of mine) {
      if (d.street === 'preflop') continue
      if (d.actionType === 'raise') aggressive++
      else if (d.actionType === 'call') calls++
    }
    if (h.sawFlop.includes(playerId)) {
      sawFlop++
      if (h.showdown.includes(playerId)) showdowns++
    }
  }

  return {
    playerId,
    hands: seated.length,
    decisions: decisions.length,
    costUsd,
    costPerDecisionUsd: ratio(costUsd, answered.length),
    costPer100HandsUsd: seated.length ? (costUsd / seated.length) * 100 : null,
    meanInputTokens: mean(answered.map((d) => d.inputTokens)),
    meanOutputTokens: mean(answered.map((d) => d.outputTokens)),
    meanReasoningTokens: mean(answered.map((d) => d.reasoningTokens)),
    latencyP50Ms: quantile(answered.map((d) => d.latencyMs), 0.5),
    latencyP95Ms: quantile(answered.map((d) => d.latencyMs), 0.95),
    latencyMeanMs: mean(answered.map((d) => d.latencyMs)),
    fallbacks,
    fallbackRate: ratio(decisions.filter((d) => d.fallback).length, decisions.length),
    modelFallbackRate: ratio(fallbacks.model, decisions.length),
    retryRate: ratio(decisions.filter((d) => d.retries > 0).length, decisions.length),
    style: { vpip: ratio(vpip, preflopHands), pfr: ratio(pfr, preflopHands), af: ratio(aggressive, calls), wtsd: ratio(showdowns, sawFlop) },
  }
}
```

`packages/analysis/src/index.ts` becomes:
```ts
export * from './hands'
export * from './outcomes'
export * from './calibration'
export * from './metrics'
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/analysis exec vitest run && pnpm --filter @ab/analysis typecheck`
Expected: PASS (20 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/analysis
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(analysis): calibration (reliability, Brier, ECE) and player metrics" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Which hands count, and paired contrasts with Holm correction

**Files:**
- Create: `apps/study/src/contrasts.ts`
- Modify: `apps/study/src/stats.ts`, `apps/study/src/progress.ts`, `apps/study/src/run.ts`, `apps/study/src/results.ts`, `apps/study/src/index.ts`
- Test: `apps/study/test/contrasts.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/study/test/contrasts.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseStudyConfig } from '../src/config'
import { holm, pairedContrasts, tTestPValue } from '../src/contrasts'
import { emptyProgress, handKeyOf } from '../src/progress'

const ids = ['jev', 'pill', 'block', 'drip', 'nimbus']
const config = parseStudyConfig({
  id: 'c',
  lineup: ids.map((id) => ({ id, kind: 'mock' })),
  masterSeed: 'm',
  budgetUsd: 1,
  targetHalfWidthBb100: 1,
  minGroups: 8,
  maxGroups: 8,
  checkEvery: 4,
  bootstrapResamples: 1000,
})

describe('holm', () => {
  it('adjusts step-down and keeps monotone order, ignoring nulls', () => {
    const out = holm([0.01, 0.04, 0.03, null])
    expect(out[0]).toBeCloseTo(0.03, 12)
    expect(out[1]).toBeCloseTo(0.06, 12)
    expect(out[2]).toBeCloseTo(0.06, 12)
    expect(out[3]).toBeNull()
    const mono = holm([0.03, 0.02]) // 0.02 x 2 = 0.04; 0.03 x 1 = 0.03 is raised to the running maximum 0.04
    expect(mono[0]).toBeCloseTo(0.04, 12)
    expect(mono[1]).toBeCloseTo(0.04, 12)
    expect(holm([0.9, 0.8])).toEqual([1, 1]) // never above 1
  })
})

describe('tTestPValue', () => {
  it('matches a reference two-sided t test', () => {
    // R: t.test(1:5)$p.value = 0.01324 (t = 4.243, df = 4)
    expect(tTestPValue([1, 2, 3, 4, 5])!).toBeCloseTo(0.013236, 5)
    expect(tTestPValue([3, 3, 3])).toBe(0)
    expect(tTestPValue([0, 0])).toBe(1)
    expect(tTestPValue([5])).toBeNull()
    // A huge t still gives a tiny positive p (the tail is computed directly, not as 1 - cdf).
    const p = tTestPValue([10, 10.1, 9.9, 10, 10.05])!
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThan(1e-6)
  })
})

describe('pairedContrasts', () => {
  it('compares the focus player with each other player by block, with Holm correction', () => {
    const p = emptyProgress()
    // Every rotation of group g: jev wins (100 + g) chips from pill; block and drip trade 50 chips each way by group.
    for (let g = 0; g < 8; g++) {
      for (let r = 0; r < 5; r++) {
        const swing = g % 2 === 0 ? 50 : -50
        p.valid.set(handKeyOf(g, r), { jev: 100 + g, pill: -(100 + g), block: swing, drip: -swing, nimbus: 0 })
      }
    }
    const rows = pairedContrasts(p, config, 8, 'jev')
    expect(rows.map((r) => r.otherId)).toEqual(['pill', 'block', 'drip', 'nimbus'])
    const vsPill = rows[0]!
    // jev minus pill per group: 2 (100 + g) chips per rotation / 100 bb * 100 = 2 (100 + g) bb/100; blocks average groups 0-3 and 4-7.
    expect(vsPill.diff.mean).toBeCloseTo(2 * 103.5, 9)
    expect(vsPill.pValue).not.toBeNull()
    for (const r of rows) {
      expect(r.pHolm!).toBeGreaterThanOrEqual(r.pValue!)
      expect(r.significant).toBe(r.pHolm! < 0.05)
    }
    expect(() => pairedContrasts(p, config, 8, 'nobody')).toThrow(/no player nobody/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/study exec vitest run test/contrasts.test.ts`
Expected: FAIL (cannot resolve `../src/contrasts`).

- [ ] **Step 3: Implement**

In `apps/study/src/progress.ts`:
- in `StudyProgress`, after the `valid` field, add:
```ts
  /** handKey -> hand id of that valid attempt (the hand the analysis uses). */
  validHandIds: Map<string, string>
```
- in `emptyProgress`, add `validHandIds: new Map(),` after `valid: new Map(),`;
- in `readProgress`, replace `if (h && !h.capped && !p.valid.has(h.key)) p.valid.set(h.key, e.net)` with:
```ts
      if (h && !h.capped && !p.valid.has(h.key)) {
        p.valid.set(h.key, e.net)
        p.validHandIds.set(h.key, e.handId)
      }
```

In `apps/study/src/stats.ts`, add immediately before the doc comment of `studentTCdf` (`/** Student t CDF …`):
```ts
/** Upper tail P(T > |t|) of Student t, computed directly (no 1 - cdf cancellation for large t). */
export function studentTTail(t: number, df: number): number {
  return 0.5 * incompleteBeta(df / (df + t * t), df / 2, 0.5)
}
```

In `apps/study/src/run.ts`, replace `if (!capped) p.valid.set(key, result.net)` with:
```ts
        if (!capped) {
          p.valid.set(key, result.net)
          p.validHandIds.set(key, `${key}#${attempt}`)
        }
```

Replace `apps/study/src/results.ts` with (same results; the per-block values move into the exported `blockValues`, which the contrasts reuse):
```ts
import { neighbourBlockSize } from '@ab/engine'
import type { StudyConfig } from './config'
import { handKeyOf, type StudyProgress } from './progress'
import { bootstrapMean, tInterval, type Interval } from './stats'

export interface PlayerResult {
  playerId: string
  /** Big blinds won per 100 hands, with a 95% Student t CI over neighbour blocks (stopping rule, published). */
  bb100: Interval
  /** The same with a percentile bootstrap CI, reported only as a sensitivity check. */
  bb100Bootstrap: Interval
  hands: number
}

export interface StudySummary {
  /** Groups used: the completed prefix, truncated to whole neighbour blocks. */
  groups: number
  blocks: number
  players: PlayerResult[]
}

/**
 * bb/100 per player over the first `groups` groups (rounded down to whole blocks, so every
 * resample keeps the seating balance). Each group's result is the player's net over all rotations;
 * each player plays one hand per rotation.
 */
export function summarize(p: StudyProgress, config: StudyConfig, prefixGroups: number): StudySummary {
  const block = neighbourBlockSize(config.lineup.length)
  const blocks = Math.floor(prefixGroups / block)
  const groups = blocks * block
  const players = config.lineup.map((spec): PlayerResult => {
    const values = blockValues(p, config, groups, spec.id)
    return {
      playerId: spec.id,
      bb100: tInterval(values),
      // Same seed for every player: resamples are joint, keeping the players' zero-sum correlation.
      bb100Bootstrap: bootstrapMean(values, config.bootstrapResamples, config.masterSeed),
      hands: groups * config.lineup.length,
    }
  })
  return { groups, blocks, players }
}

/**
 * A player's bb/100 in each whole neighbour block of the first `prefixGroups` groups. A group's
 * value is the player's net over all its rotations / rotations / big blind x 100.
 */
export function blockValues(p: StudyProgress, config: StudyConfig, prefixGroups: number, playerId: string): number[] {
  const n = config.lineup.length
  const block = neighbourBlockSize(n)
  const bb = config.format.bigBlind
  const values: number[] = []
  for (let b = 0; b < Math.floor(prefixGroups / block); b++) {
    let sum = 0
    for (let g = b * block; g < (b + 1) * block; g++) {
      let net = 0
      for (let r = 0; r < n; r++) {
        const hand = p.valid.get(handKeyOf(g, r))
        if (!hand) throw new Error(`group ${g} rotation ${r} has no valid hand`)
        net += hand[playerId] ?? 0
      }
      sum += (net / n / bb) * 100
    }
    values.push(sum / block)
  }
  return values
}
```

`apps/study/src/contrasts.ts`:
```ts
import type { StudyConfig } from './config'
import type { StudyProgress } from './progress'
import { blockValues } from './results'
import { studentTTail, tInterval, type Interval } from './stats'

/** Focus player minus another player, in bb/100, paired by neighbour block. */
export interface Contrast {
  focusId: string
  otherId: string
  /** Mean difference per block with its 95% Student t CI. */
  diff: Interval
  /** Two-sided paired t test p-value (null with fewer than 2 blocks). */
  pValue: number | null
  /** Holm-adjusted p-value across all contrasts of the focus player. */
  pHolm: number | null
  /** pHolm < 0.05. */
  significant: boolean
}

/** Holm step-down adjustment; nulls are ignored (and stay null). */
export function holm(pValues: readonly (number | null)[]): (number | null)[] {
  const ranked = pValues
    .map((p, i) => ({ p, i }))
    .filter((x): x is { p: number; i: number } => x.p !== null)
    .sort((a, b) => a.p - b.p)
  const m = ranked.length
  const out: (number | null)[] = pValues.map(() => null)
  let running = 0
  ranked.forEach(({ p, i }, k) => {
    running = Math.max(running, Math.min(1, (m - k) * p))
    out[i] = running
  })
  return out
}

/** Two-sided one-sample t test of mean 0. */
export function tTestPValue(values: readonly number[]): number | null {
  const n = values.length
  if (n < 2) return null
  const mean = values.reduce((s, v) => s + v, 0) / n
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1))
  if (sd === 0) return mean === 0 ? 1 : 0
  const t = Math.abs(mean) / (sd / Math.sqrt(n))
  return Math.min(1, 2 * studentTTail(t, n - 1))
}

/**
 * The focus player (Jev) against every other player: per-block bb/100 differences, a t CI and paired
 * t test for each, with Holm correction across the comparisons. This is how pairwise claims
 * ("Jev beat X") are made; the per-player CIs alone are marginal and don't support them.
 */
export function pairedContrasts(p: StudyProgress, config: StudyConfig, prefixGroups: number, focusId: string): Contrast[] {
  if (!config.lineup.some((s) => s.id === focusId)) throw new Error(`no player ${focusId} in the line-up`)
  const focus = blockValues(p, config, prefixGroups, focusId)
  const others = config.lineup.filter((s) => s.id !== focusId)
  const rows = others.map((s) => {
    const diffs = blockValues(p, config, prefixGroups, s.id).map((v, b) => focus[b]! - v)
    return { otherId: s.id, diff: tInterval(diffs), pValue: tTestPValue(diffs) }
  })
  const adjusted = holm(rows.map((r) => r.pValue))
  return rows.map((r, i) => ({ focusId, ...r, pHolm: adjusted[i]!, significant: adjusted[i] !== null && adjusted[i]! < 0.05 }))
}
```

Append to `apps/study/src/index.ts`:
```ts
export * from './contrasts'
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/study exec vitest run && pnpm --filter @ab/study typecheck`
Expected: PASS (40 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/study
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(study): paired contrasts with Holm correction; remember each valid hand id" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The report model and CSV export

**Files:**
- Create: `apps/study/src/report.ts`, `apps/study/src/exports.ts`
- Modify: `apps/study/package.json`, `apps/study/src/prereg.ts`, `apps/study/src/index.ts`
- Test: `apps/study/test/report.test.ts`

- [ ] **Step 1: Add the dependency and write the failing test**

In `apps/study/package.json`, add `"@ab/analysis": "workspace:*"` as the first entry of `dependencies`, then run `pnpm install`.

`apps/study/test/report.test.ts`:
```ts
import { EventStore } from '@ab/core'
import { CallingStation, MockLlm, TagBot, type Player } from '@ab/players'
import { describe, expect, it } from 'vitest'
import { parseStudyConfig, type StudyConfig } from '../src/config'
import { decisionsCsv } from '../src/exports'
import { preregistration } from '../src/prereg'
import { analyseStudy, analysedGroupCount, focusPlayer, studyHands } from '../src/report'
import { emptyProgress, handKeyOf } from '../src/progress'
import { runStudy } from '../src/run'

const ids = ['jev', 'pill', 'block', 'drip', 'nimbus']

function config(over: Record<string, unknown> = {}): StudyConfig {
  return parseStudyConfig({
    id: 'r',
    lineup: ids.map((id) => ({ id, kind: 'mock' })),
    masterSeed: 'm',
    budgetUsd: 100,
    targetHalfWidthBb100: 0.001,
    minGroups: 8,
    maxGroups: 8,
    checkEvery: 4,
    bootstrapResamples: 1000,
    decisionTimeoutMs: 1000,
    ...over,
  })
}

const mixed = (): Player[] => [new MockLlm('jev', 'mock/jev'), new TagBot('pill'), new CallingStation('block'), new MockLlm('drip', 'mock/drip'), new CallingStation('nimbus')]
const run = (c: StudyConfig, players: Player[], store: EventStore) => runStudy({ config: c, players, store, prereg: preregistration(c, c.lineup) })
const at = '2026-09-22T00:00:00.000Z'

describe('study report', () => {
  it('analyses exactly the hands behind the published results', async () => {
    const store = new EventStore()
    const c = config()
    const outcome = await run(c, mixed(), store)
    const { report, decisions } = analyseStudy(store, c, { focusId: 'jev', generatedAt: at })
    expect(report.study).toMatchObject({ id: 'r', analysedGroups: 8, blocks: 2, hands: 40, endReason: outcome.reason, status: 'ended', configHash: outcome.configHash })
    expect(report.results).toEqual(outcome.summary.players)
    expect(report.contrasts.map((x) => x.otherId)).toEqual(['pill', 'block', 'drip', 'nimbus'])
    expect(report.players[0]).toMatchObject({ playerId: 'jev', kind: 'mock', model: 'mock/jev', answeredModels: ['mock/jev'] })
    expect(report.metrics.map((m) => m.hands)).toEqual([40, 40, 40, 40, 40])
    expect(decisions.length).toBe(report.study.decisions)
    // Mock seats state win probabilities, so both calibration charts have data; calling stations state none.
    const jevCal = report.calibration[0]!
    expect(jevCal.winA.n).toBeGreaterThan(0)
    expect(jevCal.winC.n).toBe(jevCal.winA.n)
    expect(jevCal.confidenceSource).toMatch(/mock/)
    expect(report.calibration[2]!.winA.n).toBe(0)
    // Chips are conserved in every analysed hand, so bb/100 sums to zero.
    expect(report.results.reduce((s, r) => s + r.bb100.mean, 0)).toBeCloseTo(0, 9)
    expect(JSON.parse(JSON.stringify(report))).toEqual(report) // JSON-safe
    // The comparison family and the per-action rules are part of the pre-registration.
    expect(report.study.preregistration).toMatchObject({ contrasts: expect.stringContaining('Holm'), outcomes: { perAction: expect.stringContaining('winnable pot') } })
  })

  it('leaves out hands cut off by the budget cap, using the replayed attempt instead', async () => {
    const store = new EventStore()
    const pricey = () => ids.map((id, i) => (i < 3 ? new MockLlm(id, 'mock/pricey', { inputPricePerMTok: 50 }) : new CallingStation(id)))
    await run(config({ budgetUsd: 2 }), pricey(), store)
    await run(config({ budgetUsd: 50 }), pricey(), store)
    const { hands, groups } = studyHands(store, config())
    expect(groups).toBe(8)
    expect(hands).toHaveLength(40)
    expect(new Set(hands.map((h) => h.handId.split('#')[0])).size).toBe(40) // one attempt per (group, rotation)
    expect(hands.some((h) => !h.handId.endsWith('#1'))).toBe(true) // a replayed attempt is used
    const { report } = analyseStudy(store, config({ budgetUsd: 50 }), { focusId: 'jev', generatedAt: at })
    expect(report.study.costUsd).toBeGreaterThan(report.metrics.reduce((s, m) => s + m.costUsd, 0)) // cut-off hands cost money too
  })

  it('uses the logged stopping boundary until the study ends, and analysedGroups after', () => {
    const c = config({ minGroups: 40, maxGroups: 80 })
    const p = emptyProgress()
    for (let g = 0; g < 12; g++) for (let r = 0; r < 5; r++) p.valid.set(handKeyOf(g, r), {})
    expect(analysedGroupCount(p, 'running', c)).toBe(12) // no stop logged: the completed prefix
    p.lastCheckpoint = { groups: 8, stop: true } // rule met at 8, hands still finishing (or a crash)
    expect(analysedGroupCount(p, 'running', c)).toBe(8)
    p.analysedGroups = 8
    expect(analysedGroupCount(p, 'ended', c)).toBe(8)
    p.lastCheckpoint = { groups: 4, stop: false }
    p.analysedGroups = null
    expect(analysedGroupCount(p, 'interrupted', c)).toBe(12)
  })

  it('picks the Jev seat as the focus and refuses a config that is not the study', async () => {
    expect(focusPlayer(parseStudyConfig({ ...rawWith([{ id: 'x', kind: 'bot', bot: 'tag' }, { id: 'j', kind: 'jev', model: 'jev-1' }]) }))).toBe('j')
    expect(focusPlayer(config())).toBe('jev')
    const store = new EventStore()
    await run(config(), mixed(), store)
    expect(() => analyseStudy(store, config({ masterSeed: 'other' }), { focusId: 'jev', generatedAt: at })).toThrow(/not for study config/)
    expect(() => analyseStudy(new EventStore(), config(), { focusId: 'jev', generatedAt: at })).toThrow(/has not started/)
  })
})

function rawWith(lineup: unknown[]) {
  return { id: 'f', lineup, masterSeed: 'm', budgetUsd: 1, targetHalfWidthBb100: 1, minGroups: 2, maxGroups: 2, checkEvery: 2 }
}

describe('decisionsCsv', () => {
  it('writes one quoted row per decision', async () => {
    const store = new EventStore()
    await run(config({ minGroups: 4, maxGroups: 4 }), mixed(), store)
    const { decisions } = analyseStudy(store, config({ minGroups: 4, maxGroups: 4 }), { focusId: 'jev', generatedAt: at })
    const csv = decisionsCsv(decisions)
    const lines = csv.trimEnd().split('\n')
    expect(lines).toHaveLength(decisions.length + 1)
    expect(lines[0]!.split(',').slice(0, 3)).toEqual(['handId', 'index', 'playerId'])
    expect(decisionsCsv([{ ...decisions[0]!, model: 'a "quoted", model' }])).toContain('"a ""quoted"", model"')
    expect(lines[0]).toContain(',pot,winnablePot,toCall,')
    // Text that a spreadsheet would evaluate is defused; negative numbers are not.
    const row = decisionsCsv([{ ...decisions[0]!, model: '=HYPERLINK("x")', stackChange: -150 }]).split('\n')[1]!
    expect(row).toContain(`"'=HYPERLINK(""x"")"`)
    expect(row.endsWith(',-150')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/study exec vitest run test/report.test.ts`
Expected: FAIL (cannot resolve `../src/exports`).

- [ ] **Step 3: Implement**

`apps/study/src/report.ts`:
```ts
import {
  calibration,
  extractHands,
  playerInfo,
  playerMetrics,
  scoreDecisions,
  type Calibration,
  type HandRecord,
  type PlayerMetrics,
  type ScoredDecision,
  type ShareCache,
} from '@ab/analysis'
import type { EventStore, GameEvent, GameStatus, StudyEndReason } from '@ab/core'
import type { StudyConfig } from './config'
import { pairedContrasts, type Contrast } from './contrasts'
import { assertPreregMatches } from './prereg'
import { completedPrefix, handKeyOf, readProgress, type StudyProgress } from './progress'
import { summarize, type PlayerResult } from './results'

export interface PlayerCalibration {
  playerId: string
  /** What the confidence number means for this player (Jev's and the LLMs' are not the same metric). */
  confidenceSource: string
  /** Stated win probability vs outcome A (main-pot share). The headline chart. */
  winA: Calibration
  /** Stated win probability vs outcome C (expected main-pot share at the decision). */
  winC: Calibration
  /**
   * Confidence vs whether the chosen action was right, per action type. Never pooled: the rules differ
   * by type (equity for folds and calls, later chips for checks and raises) and so do their base rates.
   */
  actionByType: Record<'fold' | 'check' | 'call' | 'raise', Calibration>
}

/**
 * Everything the HTML report shows. In report.json, infinite interval bounds (fewer than 2 blocks)
 * and undefined values (NaN) appear as null.
 */
export interface StudyReport {
  kind: 'artificialBluff study report'
  version: 1
  generatedAt: string
  study: {
    id: string
    configHash: string
    status: GameStatus
    endReason: StudyEndReason | null
    /** Groups the results use (whole neighbour blocks of the completed prefix, or the stopping boundary). */
    analysedGroups: number
    blocks: number
    hands: number
    decisions: number
    /** Everything the study spent, analysed or not (e.g. hands cut off by the budget cap). */
    costUsd: number
    preregistration: unknown
  }
  players: Array<{ playerId: string; kind: string; model: string; answeredModels: string[] }>
  focusId: string
  results: PlayerResult[]
  contrasts: Contrast[]
  metrics: PlayerMetrics[]
  calibration: PlayerCalibration[]
  notes: string[]
}

export interface StudyAnalysis {
  report: StudyReport
  decisions: ScoredDecision[]
}

/** The analysis player: the first Jev seat of the (real, not mock) study config, else the first seat. */
export function focusPlayer(config: StudyConfig): string {
  return (config.lineup.find((s) => s.kind === 'jev') ?? config.lineup[0]!).id
}

/**
 * How many groups the results use: `analysedGroups` once the study has ended; the boundary of a met
 * stopping check that never reached study_ended (a crash, or hands still finishing); otherwise the
 * completed prefix. Always whole neighbour blocks (summarize truncates).
 */
export function analysedGroupCount(progress: StudyProgress, status: GameStatus | null, config: StudyConfig): number {
  if (status === 'ended' && progress.analysedGroups !== null) return progress.analysedGroups
  if (progress.lastCheckpoint?.stop) return progress.lastCheckpoint.groups
  return completedPrefix(progress, config.lineup.length, config.maxGroups)
}

/**
 * The hands the published results use: for every group in the analysed groups (whole blocks), the
 * valid attempt of each rotation. Works on one snapshot of the log, so a report taken while the study
 * runs is consistent.
 */
export function selectStudyHands(events: readonly GameEvent[], status: GameStatus | null, config: StudyConfig): { hands: HandRecord[]; groups: number; progress: StudyProgress } {
  const progress = readProgress(events)
  const n = config.lineup.length
  const groups = summarize(progress, config, analysedGroupCount(progress, status, config)).groups
  const wanted = new Set<string>()
  for (let g = 0; g < groups; g++) for (let r = 0; r < n; r++) wanted.add(progress.validHandIds.get(handKeyOf(g, r))!)
  const hands = extractHands(events).filter((h) => wanted.has(h.handId))
  if (hands.length !== wanted.size) throw new Error(`study ${config.id}: found ${hands.length} of ${wanted.size} analysed hands in the log`)
  return { hands, groups, progress }
}

/** selectStudyHands on the study's current log. */
export function studyHands(store: EventStore, config: StudyConfig): { hands: HandRecord[]; groups: number } {
  const { hands, groups } = selectStudyHands(store.events(config.id), store.game(config.id)?.status ?? null, config)
  return { hands, groups }
}

const CONFIDENCE_SOURCE: Record<string, string> = {
  jev: "derived by Jev from how concentrated its option probabilities are (TypeSafe's definition)",
  llm: 'self-reported by the model ("how sure you are this is the best action")',
  mock: 'a constant from the mock player (not meaningful)',
  bot: 'a constant or rule-based value from the bot (not meaningful)',
}

/** Builds the full report of a study from its event log. `focusId`: whose paired contrasts to report. */
export function analyseStudy(store: EventStore, config: StudyConfig, opts: { focusId: string; generatedAt: string; cache?: ShareCache }): StudyAnalysis {
  const game = store.game(config.id)
  if (!game || game.kind !== 'study') throw new Error(`study ${config.id} has not started`)
  assertPreregMatches(game.config as Record<string, unknown>, config)
  // One read of the log: everything below comes from the same snapshot.
  const events = store.events(config.id)
  const { hands, groups, progress } = selectStudyHands(events, game.status, config)
  const summary = summarize(progress, config, groups)
  const decisions = scoreDecisions(hands, opts.cache ?? new Map())
  const info = playerInfo(events)
  const spent = events.reduce((sum, e) => sum + (e.type === 'decision' ? e.costUsd : 0), 0)

  const calibrationOf = (playerId: string): PlayerCalibration => {
    const mine = decisions.filter((d) => d.playerId === playerId && !d.fallback)
    const win = mine.filter((d) => d.winProbability !== null)
    const conf = mine.filter((d) => d.confidence !== null)
    const actionOf = (type: ScoredDecision['actionType']) =>
      calibration(conf.filter((d) => d.actionType === type).map((d) => ({ p: d.confidence!, o: d.actionGood })))
    return {
      playerId,
      confidenceSource: CONFIDENCE_SOURCE[info.get(playerId)?.kind ?? ''] ?? 'unknown',
      winA: calibration(win.map((d) => ({ p: d.winProbability!, o: d.mainPotShare }))),
      winC: calibration(win.map((d) => ({ p: d.winProbability!, o: d.expectedShare }))),
      actionByType: { fold: actionOf('fold'), check: actionOf('check'), call: actionOf('call'), raise: actionOf('raise') },
    }
  }

  const report: StudyReport = {
    kind: 'artificialBluff study report',
    version: 1,
    generatedAt: opts.generatedAt,
    study: {
      id: config.id,
      configHash: game.configHash,
      status: game.status,
      endReason: progress.lastEnd,
      analysedGroups: groups,
      blocks: summary.blocks,
      hands: hands.length,
      decisions: decisions.length,
      costUsd: spent,
      preregistration: game.config,
    },
    players: config.lineup.map((s) => ({
      playerId: s.id,
      kind: info.get(s.id)?.kind ?? s.kind,
      model: info.get(s.id)?.model ?? '',
      answeredModels: [...new Set(decisions.filter((d) => d.playerId === s.id).map((d) => d.model))].sort(),
    })),
    focusId: opts.focusId,
    results: summary.players,
    contrasts: pairedContrasts(progress, config, groups, opts.focusId),
    metrics: config.lineup.map((s) => playerMetrics(hands, s.id)),
    calibration: config.lineup.map((s) => calibrationOf(s.id)),
    notes: [
      'VPIP and PFR leave out walks (hands with no preflop decision). AF is postflop bets and raises per call (undefined with no calls); WTSD is showdowns per hand seen to the flop.',
      'bb/100: 95% Student t CIs over neighbour blocks of seed groups (df = blocks - 1); the percentile bootstrap CI is a sensitivity check. Per-player CIs are marginal: claims about Jev versus another player rest on the pre-registered paired contrasts (Jev minus each other seat, Holm-corrected over those comparisons); no other pairwise claims are made.',
      'Calibration A (headline): stated win probability vs the share of the main pot actually won (1, 1/k for a k-way split, 0 after any fold). Calibration C: vs the expected main-pot share at the decision from all hole cards (exact enumeration), which removes later actions and board luck.',
      "Per-action calibration, by action type only: confidence vs whether the action was right. Folds and calls are scored by all-in equity (outcome C) against the pot odds of the pot the player could win: a fold is right below them, a call at or above them. This treats the hand as if it went to showdown now and ignores players still to act, a standard approximation. Checks and raises have no such rule: they count as right if the player's stack didn't shrink from that point to the end of the hand, so later streets feed into their score.",
      "Confidence means different things: Jev's is derived from its option probabilities, the LLMs' is self-reported. Compare each player with itself, not the two kinds with each other.",
      "Decisions that fell back to check/fold (timeouts, invalid output, provider errors) are excluded from calibration and counted under fallbacks; only invalid, empty, refused or truncated output counts against the model itself. Latency, tokens and cost per decision include timeouts (at the time limit) but not auto-played decisions (a seat skipped after repeated failures).",
      'Cost: LLMs as reported per call by OpenRouter; Jev as input tokens x the published price (see the pre-registration). "Spent" is everything the study paid for, including hands cut off by the budget cap and hands outside the analysed groups, so it can exceed the per-player totals, which cover analysed hands only.',
    ],
  }
  return { report, decisions }
}
```

In `apps/study/src/prereg.ts`, replace the `outcomes: { ... },` entry of the record with (pre-registers the per-action rules and the comparison family, so neither can change after the data is seen):
```ts
    outcomes: {
      calibrationHeadline: 'main-pot share: 1 if won alone, 1/k if split k ways, 0 if lost or folded at any point',
      calibrationSecond: 'expected main-pot share at decision time from all hole cards (exact enumeration)',
      perAction:
        'confidence vs 0/1 per action type, never pooled: fold right if all-in equity < toCall / (winnable pot + toCall), ' +
        "call right if >= it; check and raise right if the player's stack did not shrink from the action to the end of the hand",
    },
    contrasts:
      'the first jev seat minus each other seat in bb/100, paired by neighbour block: 95% t CI and two-sided paired t test, ' +
      'Holm correction over those n - 1 comparisons; no other pairwise claims',
    stopping:
      'every checkEvery groups: over the completed prefix of groups in whole neighbour blocks, stop when every ' +
      "player's 95% Student t CI (df = blocks - 1) half-width of bb/100 is at most targetHalfWidthBb100; never " +
      'before minGroups (at least 10 blocks and a check boundary, unless the study has a fixed size); at most maxGroups; every check is ' +
      'logged as a study_checkpoint event; hands cut short by the budget cap are excluded and replayed on resume',
```

`apps/study/src/exports.ts`:
```ts
import type { ScoredDecision } from '@ab/analysis'

const COLUMNS = [
  'handId', 'index', 'playerId', 'street', 'position', 'model', 'optionId', 'actionType', 'chipsIn', 'pot', 'winnablePot', 'toCall',
  'stackBefore', 'board', 'live', 'winProbability', 'confidence', 'optionProbabilities', 'latencyMs', 'inputTokens',
  'outputTokens', 'reasoningTokens', 'costUsd', 'retries', 'fallback', 'fallbackKind', 'mainPotShare', 'expectedShare',
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
```

Append to `apps/study/src/index.ts`:
```ts
export * from './report'
export * from './exports'
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/study exec vitest run && pnpm --filter @ab/study typecheck`
Expected: PASS (45 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/study pnpm-lock.yaml
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(study): study report model (results, contrasts, metrics, calibration) and CSV export" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: HTML report

**Files:**
- Create: `apps/study/src/html.ts`
- Modify: `apps/study/src/index.ts`
- Test: `apps/study/test/html.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/study/test/html.test.ts`:
```ts
import { EventStore } from '@ab/core'
import { CallingStation, MockLlm, TagBot } from '@ab/players'
import { describe, expect, it } from 'vitest'
import { parseStudyConfig } from '../src/config'
import { esc, renderReportHtml } from '../src/html'
import { preregistration } from '../src/prereg'
import { analyseStudy } from '../src/report'
import { runStudy } from '../src/run'

const ids = ['jev', 'pill', 'block', 'drip', 'nimbus']
const config = parseStudyConfig({
  id: 'h',
  lineup: ids.map((id) => ({ id, kind: 'mock' })),
  masterSeed: 'm',
  budgetUsd: 10,
  targetHalfWidthBb100: 0.001,
  minGroups: 4,
  maxGroups: 4,
  checkEvery: 4,
  bootstrapResamples: 1000,
})

async function report() {
  const store = new EventStore()
  const players = [new MockLlm('jev', 'mock/jev'), new TagBot('pill'), new CallingStation('block'), new MockLlm('drip', 'vendor/drip'), new CallingStation('nimbus')]
  await runStudy({ config, players, store, prereg: preregistration(config, config.lineup) })
  return analyseStudy(store, config, { focusId: 'jev', generatedAt: '2026-09-22T00:00:00.000Z' }).report
}

describe('renderReportHtml', () => {
  it('renders every section as one self-contained page', async () => {
    const r = await report()
    const html = renderReportHtml(r)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<title>artificialBluff study h</title>')
    for (const h of ['1. Results', '2. Head to head', '3. Cost and latency', '4. Win-probability calibration', '5. Per-action calibration', '6. Reliability', '7. Play style', '8. Method notes', '9. Pre-registration']) {
      expect(html).toContain(h)
    }
    expect(html).toContain(r.study.configHash)
    expect(html).toContain('JEV · mock/jev')
    expect(html).toContain('Holm')
    expect(html).toContain('No win probabilities stated: BLOCK · bot/calling-station, NIMBUS · bot/calling-station.')
    // Two CI charts; A and C charts for the three seats stating win probabilities (the mocks and the TAG
    // bot); per-action charts for each action type a confident player (the two mocks) took.
    const actionCharts = (['fold', 'call', 'check', 'raise'] as const).reduce((n, t) => n + r.calibration.filter((c) => c.actionByType[t].n > 0).length, 0)
    expect(actionCharts).toBeGreaterThan(0)
    expect(html.match(/<svg /g)!.length).toBe(2 + 3 + 3 + actionCharts)
    expect(html).toContain('Folds: right if all-in equity was below the pot odds')
    expect(html).toContain('Model-output fallbacks')
    expect(html).not.toMatch(/<script|<link|src=|href=/) // nothing external, nothing executable
  })

  it('keeps tiny costs and p-values readable, and flags mock and interim reports', async () => {
    const r = await report()
    r.metrics[0]!.costPerDecisionUsd = 0.0000084 // a Jev decision: ~200 tokens at $0.042 per million
    r.contrasts[0]!.pValue = 1e-9
    let html = renderReportHtml(r)
    expect(html).toContain('$0.0000084')
    expect(html).toContain('&lt;0.0001')
    expect(html).toContain('Mock seats (JEV, DRIP)')
    expect(html).not.toContain('Interim report')
    expect(html).toContain('title="focus player">◆</span>')
    r.study.status = 'running'
    html = renderReportHtml(r)
    expect(html).toContain('Interim report: the study has not ended (running)')
  })

  it('escapes everything that comes from the log or the config', async () => {
    const r = await report()
    r.players[0]!.model = '<img src=x onerror=alert(1)>'
    const html = renderReportHtml(r)
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(esc(`a&b"c'<>`)).toBe('a&amp;b&quot;c&#39;&lt;&gt;')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/study exec vitest run test/html.test.ts`
Expected: FAIL (cannot resolve `../src/html`).

- [ ] **Step 3: Implement**

`apps/study/src/html.ts` (one self-contained page: inline CSS in the Broadcast palette, inline SVG charts, no scripts):
```ts
import type { Calibration } from '@ab/analysis'
import type { StudyReport } from './report'

/** Escapes text for HTML element content and attribute values. */
export function esc(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

const num = (x: number | null | undefined, digits = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '–' : x.toFixed(digits))
const pct = (x: number | null | undefined, digits = 1) => (x === null || x === undefined ? '–' : `${(x * 100).toFixed(digits)}%`)
/** Dollars with at least three significant digits (Jev's cost per decision is millionths of a dollar). */
const usd = (x: number | null | undefined) => {
  if (x === null || x === undefined) return '–'
  if (x === 0) return '$0'
  const digits = Math.min(12, Math.max(4, Math.ceil(-Math.log10(Math.abs(x))) + 2))
  return `$${x.toFixed(digits)}`
}
const pValue = (p: number | null) => (p === null ? '–' : p < 0.0001 ? '&lt;0.0001' : p.toFixed(4))
const ms = (x: number | null | undefined) => (x === null || x === undefined ? '–' : x >= 1000 ? `${(x / 1000).toFixed(2)} s` : x < 1 ? '<1 ms' : `${x.toFixed(0)} ms`)
const ci = (low: number, high: number) => (Number.isFinite(low) && Number.isFinite(high) ? `[${low.toFixed(1)}, ${high.toFixed(1)}]` : '[–∞, ∞]')

function table(head: string[], rows: string[][], numericFrom = 1): string {
  const th = head.map((h, i) => `<th${i >= numericFrom ? ' class="n"' : ''}>${esc(h)}</th>`).join('')
  const body = rows.map((r) => `<tr>${r.map((c, i) => `<td${i >= numericFrom ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`).join('')
  return `<div class="scroll"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`
}

/** Horizontal CI bars (mean dot, 95% t CI whiskers) around a zero line. */
function forestPlot(rows: Array<{ label: string; mean: number; low: number; high: number; highlight?: boolean }>, unit: string): string {
  const finite = rows.flatMap((r) => [r.low, r.high, r.mean]).filter(Number.isFinite)
  const span = Math.max(1, ...finite.map(Math.abs)) * 1.1
  const w = 640
  const left = 200
  const right = 20
  const rowH = 30
  const h = rows.length * rowH + 40
  const x = (v: number) => left + ((Math.max(-span, Math.min(span, v)) + span) / (2 * span)) * (w - left - right)
  const lines = rows
    .map((r, i) => {
      const y = 20 + i * rowH + rowH / 2
      const lo = Number.isFinite(r.low) ? x(r.low) : left
      const hi = Number.isFinite(r.high) ? x(r.high) : w - right
      const colour = r.highlight ? 'var(--brass)' : 'var(--cream)'
      return (
        `<text x="${left - 10}" y="${y + 4}" text-anchor="end" class="lbl">${esc(r.label)}</text>` +
        `<line x1="${lo}" x2="${hi}" y1="${y}" y2="${y}" stroke="${colour}" stroke-width="2"/>` +
        `<line x1="${lo}" x2="${lo}" y1="${y - 6}" y2="${y + 6}" stroke="${colour}" stroke-width="2"/>` +
        `<line x1="${hi}" x2="${hi}" y1="${y - 6}" y2="${y + 6}" stroke="${colour}" stroke-width="2"/>` +
        (Number.isFinite(r.mean) ? `<circle cx="${x(r.mean)}" cy="${y}" r="5" fill="${colour}"/>` : '')
      )
    })
    .join('')
  const axis =
    `<line x1="${x(0)}" x2="${x(0)}" y1="10" y2="${h - 25}" stroke="var(--muted)" stroke-dasharray="4 4"/>` +
    `<text x="${x(-span)}" y="${h - 8}" class="tick">${(-span).toFixed(0)}</text>` +
    `<text x="${x(0)}" y="${h - 8}" text-anchor="middle" class="tick">0 ${esc(unit)}</text>` +
    `<text x="${x(span)}" y="${h - 8}" text-anchor="end" class="tick">${span.toFixed(0)}</text>`
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(unit)} with 95% confidence intervals">${axis}${lines}</svg>`
}

/** Reliability diagram: mean stated probability vs mean outcome per bin, dot area by count. */
function reliability(cal: Calibration, title: string): string {
  const s = 200
  const pad = 28
  const inner = s - 2 * pad
  const px = (v: number) => pad + v * inner
  const py = (v: number) => s - pad - v * inner
  const bins = cal.bins.filter((b) => b.n > 0)
  const maxN = Math.max(1, ...bins.map((b) => b.n))
  const path = bins.map((b, i) => `${i ? 'L' : 'M'}${px(b.meanPredicted!).toFixed(1)},${py(b.meanObserved!).toFixed(1)}`).join('')
  const dots = bins
    .map((b) => `<circle cx="${px(b.meanPredicted!).toFixed(1)}" cy="${py(b.meanObserved!).toFixed(1)}" r="${(2 + 6 * Math.sqrt(b.n / maxN)).toFixed(1)}" fill="var(--brass)"><title>${b.n} decisions</title></circle>`)
    .join('')
  const body =
    `<rect x="${pad}" y="${pad}" width="${inner}" height="${inner}" fill="none" stroke="var(--rule)"/>` +
    `<line x1="${px(0)}" y1="${py(0)}" x2="${px(1)}" y2="${py(1)}" stroke="var(--muted)" stroke-dasharray="4 4"/>` +
    (path ? `<path d="${path}" fill="none" stroke="var(--brass)" stroke-width="1.5"/>` : '') +
    dots +
    `<text x="${px(0)}" y="${s - 14}" text-anchor="middle" class="tick">0</text><text x="${px(1)}" y="${s - 14}" text-anchor="middle" class="tick">1</text>` +
    `<text x="${pad - 6}" y="${py(1) + 4}" text-anchor="end" class="tick">1</text>` +
    `<text x="${px(0.5)}" y="${s - 6}" text-anchor="middle" class="tick">stated</text>` +
    `<text x="10" y="${py(0.5)}" text-anchor="middle" class="tick" transform="rotate(-90 10 ${py(0.5)})">outcome</text>`
  const stats = cal.n ? `n ${cal.n} · Brier ${num(cal.brier, 3)} · ECE ${num(cal.ece, 3)}` : 'no data'
  return `<figure class="rel"><svg viewBox="0 0 ${s} ${s}" role="img" aria-label="${esc(title)} reliability diagram">${body}</svg><figcaption><b>${esc(title)}</b><br>${esc(stats)}</figcaption></figure>`
}

const STYLE = `
:root{--felt:#0B2A24;--panel:#0E3029;--panel2:#123A32;--rule:#1F4A40;--cream:#F3EBDD;--muted:#9DB8AE;--brass:#E8B04A;--alert:#D9534F}
*{box-sizing:border-box}
body{margin:0;background:var(--felt);color:var(--cream);font:15px/1.5 Barlow,system-ui,sans-serif}
main{max-width:1080px;margin:0 auto;padding:24px 16px 64px}
h1,h2{font-family:"Barlow Condensed",Barlow,system-ui,sans-serif;letter-spacing:.02em}
h1{font-size:34px;margin:0 0 4px}h1 span{color:var(--brass)}
h2{font-size:22px;margin:40px 0 12px;border-bottom:1px solid var(--rule);padding-bottom:6px}
h3{font-size:16px;margin:24px 0 8px;color:var(--muted);font-weight:600}
.sub{color:var(--muted);margin:0 0 24px}
.meta{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}
.meta div{background:var(--panel);border:1px solid var(--rule);border-radius:6px;padding:8px 10px}
.meta dt{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em}.meta dd{margin:0;word-break:break-all}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;background:var(--panel);font-variant-numeric:tabular-nums}
th,td{padding:6px 10px;border-bottom:1px solid var(--rule);text-align:left;white-space:nowrap}
th{color:var(--muted);font-weight:600;font-size:13px;background:var(--panel2)}
td.n,th.n{text-align:right}
tr.focus td{color:var(--brass)}
svg{width:100%;height:auto;display:block;background:var(--panel);border:1px solid var(--rule);border-radius:6px}
svg .lbl{fill:var(--cream);font-size:13px}svg .tick{fill:var(--muted);font-size:11px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
figure.rel{margin:0}figcaption{font-size:13px;color:var(--muted);margin-top:4px}figcaption b{color:var(--cream)}
.yes{color:var(--brass);font-weight:600}.no{color:var(--muted)}
.mark{color:var(--brass)}
.banner{border:1px solid var(--alert);color:var(--cream);background:rgba(217,83,79,.12);border-radius:6px;padding:8px 12px;margin:0 0 16px}
.note{color:var(--muted)}ul.notes li{margin-bottom:6px}
td span.note{white-space:normal;display:inline-block;min-width:240px;text-align:left}
details{background:var(--panel);border:1px solid var(--rule);border-radius:6px;padding:8px 12px}
pre{white-space:pre-wrap;word-break:break-all;font-size:12px;color:var(--muted)}
`

/** The whole report as one self-contained HTML page (no scripts, no external requests). */
export function renderReportHtml(report: StudyReport): string {
  const label = new Map(report.players.map((p) => [p.playerId, `${p.playerId.toUpperCase()} · ${p.model}`]))
  // Charts have little room: seat plus the model without its vendor prefix, at most 26 characters.
  const short = new Map(
    report.players.map((p) => {
      const text = `${p.playerId.toUpperCase()} · ${p.model.split('/').at(-1)}`
      return [p.playerId, text.length > 26 ? `${text.slice(0, 25)}…` : text]
    }),
  )
  const name = (id: string) =>
    esc(label.get(id) ?? id) + (id === report.focusId ? ' <span class="mark" title="focus player">◆</span>' : '')
  const focusRow = (id: string) => (id === report.focusId ? ' class="focus"' : '')
  const rowsWithFocus = (html: string, ids: string[]) => {
    let i = 0
    return html.replace(/<tr>(?=<td)/g, () => `<tr${focusRow(ids[i++] ?? '')}>`)
  }
  const s = report.study
  const ids = report.players.map((p) => p.playerId)
  const mocks = report.players.filter((p) => p.kind === 'mock').map((p) => p.playerId.toUpperCase())
  const banners =
    (mocks.length ? `<p class="banner">Mock seats (${esc(mocks.join(', '))}): free stand-ins with scripted play and simulated costs. Not research results.</p>` : '') +
    (s.status !== 'ended' ? `<p class="banner">Interim report: the study has not ended (${esc(s.status)}). Numbers will change.</p>` : '')

  const meta = [
    ['Study', s.id],
    ['Status', `${s.status}${s.endReason ? ` (${s.endReason})` : ''}`],
    ['Analysed', `${s.analysedGroups} groups · ${s.blocks} blocks · ${s.hands} hands`],
    ['Decisions', String(s.decisions)],
    ['Spent (all hands)', usd(s.costUsd)],
    ['Pre-registration hash', s.configHash],
    ['Generated', report.generatedAt],
  ]
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
    .join('')

  const lineup = table(
    ['Seat', 'Kind', 'Configured model', 'Answered as'],
    report.players.map((p) => [esc(p.playerId.toUpperCase()), esc(p.kind), esc(p.model), esc(p.answeredModels.join(', ') || '–')]),
    4,
  )

  const results =
    forestPlot(
      report.results.map((r) => ({ label: short.get(r.playerId) ?? r.playerId, mean: r.bb100.mean, low: r.bb100.low, high: r.bb100.high, highlight: r.playerId === report.focusId })),
      'bb/100',
    ) +
    rowsWithFocus(
      table(
        ['Player', 'bb/100', '95% t CI', 'Bootstrap CI (sensitivity)', 'Hands'],
        report.results.map((r) => [name(r.playerId), num(r.bb100.mean), ci(r.bb100.low, r.bb100.high), ci(r.bb100Bootstrap.low, r.bb100Bootstrap.high), String(r.hands)]),
      ),
      report.results.map((r) => r.playerId),
    )

  const focusName = name(report.focusId)
  const contrasts =
    `<p class="note">${focusName} minus each opponent, paired by neighbour block. Significant means Holm-adjusted p &lt; 0.05 across all ${report.contrasts.length} comparisons.</p>` +
    forestPlot(
      report.contrasts.map((c) => ({ label: `vs ${short.get(c.otherId) ?? c.otherId}`, mean: c.diff.mean, low: c.diff.low, high: c.diff.high, highlight: c.significant })),
      'bb/100 difference',
    ) +
    table(
      ['Opponent', 'Difference (bb/100)', '95% t CI (unadjusted)', 'p', 'p (Holm)', 'Significant'],
      report.contrasts.map((c) => [
        name(c.otherId),
        num(c.diff.mean),
        ci(c.diff.low, c.diff.high),
        pValue(c.pValue),
        pValue(c.pHolm),
        c.significant ? '<span class="yes">yes</span>' : '<span class="no">no</span>',
      ]),
    )

  const cost = rowsWithFocus(
    table(
      ['Player', 'Decisions', '$ / decision', '$ / 100 hands', 'Total', 'Latency p50', 'Latency p95', 'Input tok', 'Output tok', 'Reasoning tok'],
      report.metrics.map((m) => [
        name(m.playerId),
        String(m.decisions),
        usd(m.costPerDecisionUsd),
        usd(m.costPer100HandsUsd),
        usd(m.costUsd),
        ms(m.latencyP50Ms),
        ms(m.latencyP95Ms),
        num(m.meanInputTokens, 0),
        num(m.meanOutputTokens, 0),
        num(m.meanReasoningTokens, 0),
      ]),
    ),
    ids,
  )

  /** One reliability chart per player with data, and a note naming those without. */
  const grid = (pick: (c: StudyReport['calibration'][number]) => Calibration, missing: string) => {
    const withData = report.calibration.filter((c) => pick(c).n > 0)
    const without = report.calibration.filter((c) => pick(c).n === 0).map((c) => label.get(c.playerId) ?? c.playerId)
    return (
      `<div class="grid">${withData.map((c) => reliability(pick(c), label.get(c.playerId) ?? c.playerId)).join('')}</div>` +
      (without.length ? `<p class="note">${esc(missing)}: ${esc(without.join(', '))}.</p>` : '')
    )
  }
  const calA = grid((c) => c.winA, 'No win probabilities stated')
  const calC = grid((c) => c.winC, 'No win probabilities stated')
  const ACTIONS = [
    ['fold', 'Folds: right if all-in equity was below the pot odds'],
    ['call', 'Calls: right if all-in equity met the pot odds'],
    ['check', "Checks: right if the player's stack didn't shrink afterwards"],
    ['raise', "Bets and raises: right if the player's stack didn't shrink afterwards"],
  ] as const
  const calAction = ACTIONS.map(([type, title]) => `<h3>${esc(title)}</h3>${grid((c) => c.actionByType[type], 'No confident actions of this type')}`).join('')
  const calTable = rowsWithFocus(
    table(
      ['Player', 'Win A: Brier', 'ECE', 'Win C: Brier', 'ECE', 'n', 'Confidence is'],
      report.calibration.map((c) => [
        name(c.playerId),
        num(c.winA.brier, 3),
        num(c.winA.ece, 3),
        num(c.winC.brier, 3),
        num(c.winC.ece, 3),
        String(c.winA.n),
        `<span class="note">${esc(c.confidenceSource)}</span>`,
      ]),
    ),
    ids,
  )
  const byType = table(
    ['Player', 'Fold', 'Check', 'Call', 'Raise'],
    report.calibration.map((c) => [
      name(c.playerId),
      ...(['fold', 'check', 'call', 'raise'] as const).map((t) => {
        const k = c.actionByType[t]
        return k.n ? `${num(k.brier, 3)} <span class="note">(n ${k.n})</span>` : '–'
      }),
    ]),
  )

  const fallbacks = table(
    ['Player', 'Model-output fallbacks', 'All fallbacks', 'Invalid output', 'Provider / network', 'Timeout', 'Auto-played', 'Needed a retry'],
    report.metrics.map((m) => [name(m.playerId), pct(m.modelFallbackRate, 2), pct(m.fallbackRate, 2), String(m.fallbacks.model), String(m.fallbacks.infra), String(m.fallbacks.timeout), String(m.fallbacks.auto), pct(m.retryRate, 2)]),
  )
  const style = table(
    ['Player', 'VPIP', 'PFR', 'Aggression (AF)', 'Went to showdown'],
    report.metrics.map((m) => [name(m.playerId), pct(m.style.vpip), pct(m.style.pfr), num(m.style.af, 2), pct(m.style.wtsd)]),
  )

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`artificialBluff study ${s.id}`)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>artificial<span>Bluff</span> · study ${esc(s.id)}</h1>
<p class="sub">Duplicate-format No-Limit Hold'em: Jev against LLMs on results, cost, latency and calibration. ◆ marks the focus player of the head-to-head comparisons.</p>
${banners}
<dl class="meta">${meta}</dl>
<h2>Line-up</h2>${lineup}
<h2>1. Results</h2>${results}
<h2>2. Head to head</h2>${contrasts}
<h2>3. Cost and latency</h2>${cost}
<h2>4. Win-probability calibration</h2>
<p class="note">Headline (A): stated win probability against the share of the main pot actually won. Dashed line: perfect calibration.</p>
${calA}
<p class="note">Second chart (C): against the expected main-pot share at the moment of the decision, from all hole cards (exact enumeration), which removes later actions and board luck.</p>
${calC}
${calTable}
<h2>5. Per-action calibration</h2>
<p class="note">Confidence against whether the chosen action was right, one action type at a time (the rules and base rates differ, so they are never pooled). Jev's confidence and the LLMs' are different quantities (see the table above): compare each player with itself.</p>
${calAction}
<p class="note">Brier score by action type:</p>
${byType}
<h2>6. Reliability</h2>${fallbacks}
<h2>7. Play style</h2>${style}
<h2>8. Method notes</h2>
<ul class="notes">${report.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
<h2>9. Pre-registration</h2>
<details><summary>Pre-registered configuration (hash ${esc(s.configHash)})</summary><pre>${esc(JSON.stringify(s.preregistration, null, 2))}</pre></details>
</main>
</body>
</html>
`
}
```

Append to `apps/study/src/index.ts`:
```ts
export * from './html'
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/study exec vitest run && pnpm --filter @ab/study typecheck`
Expected: PASS (48 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/study
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(study): self-contained HTML report with CI and reliability charts" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: `pnpm study report`

**Files:**
- Modify: `apps/study/src/commands.ts`, `apps/study/src/cli.ts`, `.gitignore`
- Test: `apps/study/test/commands.test.ts`

- [ ] **Step 1: Write the failing test**

Replace `apps/study/test/commands.test.ts` with (adds the report test and the `report` argument cases):
```ts
import { EventStore } from '@ab/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mockVariant, parseCliArgs, preregCommand, reportCommand, runCommand, statusCommand } from '../src/commands'
import { parseStudyConfig } from '../src/config'

const config = parseStudyConfig({
  id: 'smoke',
  lineup: [
    { id: 'jev', kind: 'jev', model: 'jev-1.13.0' },
    { id: 'pill', kind: 'llm', model: 'vendor/frontier' },
    { id: 'drip', kind: 'bot', bot: 'tag' },
    { id: 'block', kind: 'llm', model: 'vendor/other' },
    { id: 'nimbus', kind: 'bot', bot: 'calling-station' },
  ],
  masterSeed: 'm',
  budgetUsd: 1,
  targetHalfWidthBb100: 1,
  minGroups: 4,
  maxGroups: 4,
  checkEvery: 4,
  concurrency: 2,
  bootstrapResamples: 1000,
})

describe('study commands (mock mode: free, no network, no keys)', () => {
  const capture = () => {
    const lines: string[] = []
    return { lines, deps: { env: {}, log: (l: string) => lines.push(l) } }
  }

  it('turns paid seats into mocks under a separate study id', () => {
    const m = mockVariant(config)
    expect(m.id).toBe('smoke-mock')
    expect(m.lineup.map((s) => s.kind)).toEqual(['mock', 'mock', 'bot', 'mock', 'bot'])
    expect(m.lineup[1]).toEqual({ id: 'pill', kind: 'mock', model: 'mock/vendor/frontier' })
  })

  it('prints the pre-registration and its hash', async () => {
    const { lines, deps } = capture()
    const hash = await preregCommand(config, true, deps)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(lines.at(-1)).toBe(`pre-registration hash: ${hash}`)
    expect(JSON.parse(lines[0]!)).toMatchObject({ kind: 'artificialBluff study', study: { id: 'smoke-mock' } })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('runs a mock study and reports status', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('mock mode must not use the network')))
    const store = new EventStore()
    const run = capture()
    const outcome = await runCommand(config, true, store, run.deps)
    expect(outcome.reason).toBe('max_groups')
    expect(run.lines.some((l) => l.startsWith('ended: max_groups'))).toBe(true)
    const status = capture()
    statusCommand(config, true, store, status.deps)
    expect(status.lines[0]).toMatch(/^study smoke-mock: ended \(max_groups\), 20 hands played/)
    expect(status.lines.some((l) => l.includes('bb/100'))).toBe(true)
  })

  it('reports a study that has not started', () => {
    const { lines, deps } = capture()
    statusCommand(config, true, new EventStore(), deps)
    expect(lines).toEqual(['study smoke-mock has not started'])
  })

  it('refuses to resume a study whose budget is spent, and says a finished study is finished', async () => {
    const store = new EventStore()
    const broke = { ...config, budgetUsd: 0.00001 }
    expect((await runCommand(broke, true, store, capture().deps)).reason).toBe('budget_cap')
    await expect(runCommand(broke, true, store, capture().deps)).rejects.toThrow(/budget already spent .* raise budgetUsd/)
    const done = new EventStore()
    await runCommand(config, true, done, capture().deps)
    const again = capture()
    await runCommand(config, true, done, again.deps)
    expect(again.lines[0]).toBe('study smoke-mock already finished (max_groups)')
  })

  it('writes a report of a mock study for free', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('reports must not use the network')))
    const store = new EventStore()
    await runCommand(config, true, store, capture().deps)
    const out = mkdtempSync(join(tmpdir(), 'ab-report-'))
    const { lines, deps } = capture()
    const files = reportCommand(config, true, store, out, deps, '2026-09-22T00:00:00.000Z')
    expect(files.map((f) => f.slice(out.length + 1))).toEqual(['report.html', 'report.json', 'decisions.csv', 'decisions.json'])
    expect(lines[0]).toMatch(/^study smoke-mock: 20 hands, \d+ decisions analysed in/)
    const json = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))
    expect(json).toMatchObject({ kind: 'artificialBluff study report', focusId: 'jev', study: { id: 'smoke-mock', hands: 20 } })
    const rows = JSON.parse(readFileSync(join(out, 'decisions.json'), 'utf8'))
    expect(readFileSync(join(out, 'decisions.csv'), 'utf8').trimEnd().split('\n')).toHaveLength(rows.length + 1)
    expect(readFileSync(join(out, 'report.html'), 'utf8')).toContain('study smoke-mock')
  })
})

describe('study CLI arguments', () => {
  it('needs an explicit --mock or --live to run, so a typo never starts a paid run', () => {
    expect(parseCliArgs(['run', 'x.json', '--mock'])).toMatchObject({ command: 'run', mock: true, live: false, db: 'data/studies.db' })
    expect(parseCliArgs(['run', 'x.json', '--live', '--takeover', '--db', 'd.db'])).toMatchObject({ live: true, takeover: true, db: 'd.db' })
    expect(() => parseCliArgs(['run', 'x.json'])).toThrow(/--mock \(free rehearsal\) or --live \(spends real money/)
    expect(() => parseCliArgs(['run', 'x.json', '--Mock'])).toThrow(/unknown argument for run: --Mock/)
    expect(() => parseCliArgs(['run', 'x.json', '--mock', '--live'])).toThrow(/not both/)
    expect(() => parseCliArgs(['run', 'x.json', '--mock', '--db'])).toThrow(/--db needs a path/)
    expect(() => parseCliArgs(['run', 'x.json', '--db', '--mock'])).toThrow(/--db needs a path/)
    expect(() => parseCliArgs(['status', 'x.json', '--live'])).toThrow(/unknown argument/)
    expect(() => parseCliArgs(['go', 'x.json'])).toThrow(/unknown command/)
    expect(() => parseCliArgs(['run'])).toThrow(/missing <config.json>/)
    expect(parseCliArgs(['report', 'x.json', '--mock', '--out', 'r'])).toMatchObject({ command: 'report', mock: true, out: 'r' })
    expect(parseCliArgs(['report', 'x.json']).out).toBeNull()
    expect(() => parseCliArgs(['report', 'x.json', '--out'])).toThrow(/--out needs a directory/)
    expect(() => parseCliArgs(['run', 'x.json', '--mock', '--out', 'r'])).toThrow(/unknown argument for run: --out/)
    expect(() => parseCliArgs(['report', 'x.json', '--live'])).toThrow(/unknown argument for report: --live/)
  })

})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/study exec vitest run test/commands.test.ts`
Expected: FAIL (`reportCommand` is not exported; `report` is an unknown command).

- [ ] **Step 3: Implement**

Replace `apps/study/src/commands.ts` with:
```ts
import { configHash, EventStore } from '@ab/core'
import { adaptLineup, createPlayers, fetchModelCatalog, type PlayerEnv, type PlayerSpec } from '@ab/players'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseStudyConfig, type StudyConfig } from './config'
import { assertPreregMatches, preregistration } from './prereg'
import { readStoreProgress } from './progress'
import { summarize, type StudySummary } from './results'
import { decisionsCsv } from './exports'
import { renderReportHtml } from './html'
import { analyseStudy, analysedGroupCount, focusPlayer } from './report'
import { runStudy, type StudyOutcome } from './run'

export function loadStudyConfig(path: string): StudyConfig {
  return parseStudyConfig(JSON.parse(readFileSync(path, 'utf8')))
}

/** A free dry run: every paid seat becomes a mock, under a separate study id so data never mixes. */
export function mockVariant(config: StudyConfig): StudyConfig {
  const lineup: PlayerSpec[] = config.lineup.map((s) =>
    s.kind === 'jev' || s.kind === 'llm' ? { id: s.id, kind: 'mock', model: `mock/${s.model}` } : s,
  )
  return { ...config, id: `${config.id}-mock`, lineup }
}

/** Line-up with request flags filled from the model catalog (real runs), or as-is (mock runs). */
export async function resolveLineup(config: StudyConfig, mock: boolean, log: (line: string) => void): Promise<PlayerSpec[]> {
  if (mock) return config.lineup
  const { specs, problems } = adaptLineup(config.lineup, await fetchModelCatalog())
  for (const p of problems) log(`preflight: ${p}`)
  if (problems.some((p) => p.includes('not in the OpenRouter catalog'))) throw new Error('preflight failed: unknown model(s)')
  return specs
}

export function formatSummary(summary: StudySummary, costUsd: number): string[] {
  const lines = [`${summary.groups} groups (${summary.blocks} blocks), $${costUsd.toFixed(4)} spent`]
  for (const p of summary.players) {
    const half = Number.isFinite(p.bb100.halfWidth) ? `± ${p.bb100.halfWidth.toFixed(1)}` : '± ∞'
    const mean = Number.isFinite(p.bb100.mean) ? p.bb100.mean.toFixed(1) : 'n/a'
    lines.push(`  ${p.playerId.padEnd(8)} ${mean.padStart(8)} bb/100 ${half}`)
  }
  return lines
}

export interface CommandDeps {
  env: PlayerEnv
  log: (line: string) => void
  signal?: AbortSignal
  /** Resume a study a crash left marked 'running' (never while another process runs it). */
  takeover?: boolean
}

/** Prints the pre-registration record and its hash without running anything. */
export async function preregCommand(config: StudyConfig, mock: boolean, deps: CommandDeps): Promise<string> {
  const c = mock ? mockVariant(config) : config
  const record = preregistration(c, await resolveLineup(c, mock, deps.log))
  deps.log(JSON.stringify(record, null, 2))
  const hash = configHash(record)
  deps.log(`pre-registration hash: ${hash}`)
  return hash
}

export async function runCommand(config: StudyConfig, mock: boolean, store: EventStore, deps: CommandDeps): Promise<StudyOutcome> {
  const c = mock ? mockVariant(config) : config
  const game = store.game(c.id)
  let lineup: PlayerSpec[]
  if (game) {
    // Resume with the pre-registered line-up: re-adapting it to today's model catalog could change
    // its request flags, and so the hash, and lock the study out.
    const record = game.config as Record<string, unknown>
    assertPreregMatches(record, c)
    lineup = (record.study as { lineup: PlayerSpec[] }).lineup
    const progress = readStoreProgress(store, c.id)
    if (progress.lastEnd === 'ci_target' || progress.lastEnd === 'max_groups') deps.log(`study ${c.id} already finished (${progress.lastEnd})`)
    const spent = store.gameCost(c.id)
    if (progress.lastEnd === 'budget_cap' && spent >= c.budgetUsd) {
      throw new Error(`study ${c.id}: budget already spent ($${spent.toFixed(4)} of $${c.budgetUsd}); raise budgetUsd to resume`)
    }
  } else {
    lineup = await resolveLineup(c, mock, deps.log)
  }
  const players = createPlayers(lineup, deps.env)
  const prereg = preregistration(c, lineup)
  if (mock) deps.log('mock mode: no API calls are made; costs shown are simulated')
  else deps.log(`REAL RUN: this spends real money, up to $${c.budgetUsd} for the whole study`)
  deps.log(`study ${c.id}: ${players.map((p) => `${p.id}=${p.model}`).join(', ')}`)
  deps.log(`pre-registration hash ${configHash(prereg)}; budget $${c.budgetUsd}; ${c.concurrency} table(s)`)
  if (c.concurrency > 1) deps.log(`note: up to ${c.concurrency} decisions already in flight can finish after the budget is reached`)
  const outcome = await runStudy({
    config: c,
    players,
    store,
    prereg,
    ...(deps.signal ? { signal: deps.signal } : {}),
    ...(deps.takeover ? { takeover: true } : {}),
    onCheckpoint: (summary, cost) => formatSummary(summary, cost).forEach(deps.log),
  })
  deps.log(`ended: ${outcome.reason}`)
  formatSummary(outcome.summary, outcome.costUsd).forEach(deps.log)
  return outcome
}

export function statusCommand(config: StudyConfig, mock: boolean, store: EventStore, deps: CommandDeps): void {
  const c = mock ? mockVariant(config) : config
  const game = store.game(c.id)
  if (!game) {
    deps.log(`study ${c.id} has not started`)
    return
  }
  assertPreregMatches(game.config as Record<string, unknown>, c)
  const progress = readStoreProgress(store, c.id)
  const groups = analysedGroupCount(progress, game.status, c)
  deps.log(`study ${c.id}: ${game.status}${progress.lastEnd ? ` (${progress.lastEnd})` : ''}, ${progress.handsPlayed} hands played, hash ${game.configHash.slice(0, 12)}…`)
  formatSummary(summarize(progress, c, groups), store.gameCost(c.id)).forEach(deps.log)
}

/**
 * Writes the study report to `outDir`: report.html (self-contained), report.json (every number in the
 * report), decisions.csv and decisions.json (one row per analysed decision, with its outcomes).
 * Free: reads the event log only. Returns the files written.
 */
export function reportCommand(config: StudyConfig, mock: boolean, store: EventStore, outDir: string, deps: CommandDeps, generatedAt = new Date().toISOString()): string[] {
  const c = mock ? mockVariant(config) : config
  const started = Date.now()
  const { report, decisions } = analyseStudy(store, c, { focusId: focusPlayer(config), generatedAt })
  mkdirSync(outDir, { recursive: true })
  const files: Array<[string, string]> = [
    ['report.html', renderReportHtml(report)],
    ['report.json', `${JSON.stringify(report, null, 2)}\n`],
    ['decisions.csv', decisionsCsv(decisions)],
    ['decisions.json', `${JSON.stringify(decisions)}\n`],
  ]
  const written = files.map(([name, content]) => {
    const path = join(outDir, name)
    writeFileSync(path, content)
    return path
  })
  deps.log(`study ${c.id}: ${report.study.hands} hands, ${report.study.decisions} decisions analysed in ${((Date.now() - started) / 1000).toFixed(1)} s`)
  for (const path of written) deps.log(`  wrote ${path}`)
  return written
}

export interface CliArgs {
  command: 'prereg' | 'run' | 'status' | 'report'
  configPath: string
  mock: boolean
  live: boolean
  takeover: boolean
  db: string
  /** report only: output directory (default reports/<study id>, "-mock" appended in mock mode). */
  out: string | null
}

export const USAGE =
  'usage: pnpm study prereg <config.json> [--mock]\n' +
  '       pnpm study run    <config.json> (--mock | --live) [--takeover] [--db path]\n' +
  '       pnpm study status <config.json> [--mock] [--db path]\n' +
  '       pnpm study report <config.json> [--mock] [--db path] [--out dir]'

/**
 * Strict argument parsing: unknown arguments are errors, and `run` needs an explicit --mock (free)
 * or --live (real money), so a typo can never start a paid run.
 */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  const [command, configPath, ...rest] = argv
  if (command !== 'prereg' && command !== 'run' && command !== 'status' && command !== 'report') throw new Error(`unknown command: ${command ?? '(none)'}`)
  if (!configPath || configPath.startsWith('-')) throw new Error('missing <config.json>')
  const args: CliArgs = { command, configPath, mock: false, live: false, takeover: false, db: 'data/studies.db', out: null }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!
    if (a === '--mock') args.mock = true
    else if (a === '--live' && command === 'run') args.live = true
    else if (a === '--takeover' && command === 'run') args.takeover = true
    else if (a === '--db' && command !== 'prereg') {
      const path = rest[++i]
      if (!path || path.startsWith('-')) throw new Error('--db needs a path')
      args.db = path
    } else if (a === '--out' && command === 'report') {
      const path = rest[++i]
      if (!path || path.startsWith('-')) throw new Error('--out needs a directory')
      args.out = path
    } else throw new Error(`unknown argument for ${command}: ${a}`)
  }
  if (args.mock && args.live) throw new Error('use --mock or --live, not both')
  if (command === 'run' && !args.mock && !args.live) {
    throw new Error('run needs --mock (free rehearsal) or --live (spends real money, up to the study budget)')
  }
  return args
}
```

Replace `apps/study/src/cli.ts` with:
```ts
/**
 * pnpm study prereg <config.json> [--mock]                   print the pre-registration record and hash
 * pnpm study run    <config.json> (--mock | --live)          run or resume a study; --live spends real money
 * pnpm study status <config.json> [--mock]                   progress, cost and current bb/100 intervals
 * pnpm study report <config.json> [--mock] [--out dir]       write the HTML report and CSV/JSON exports (free)
 * Options: --db <path> (default data/studies.db); --takeover resumes a study a crash left marked
 * running (only if no other run of it is active). Keys come from .env (see .env.example).
 * Exit codes: 0 finished (or prereg/status/report), 1 error, 2 usage, 3 stopped early (budget cap or
 * interrupted: resume by running again).
 */
import { EventStore } from '@ab/core'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadStudyConfig, parseCliArgs, preregCommand, reportCommand, runCommand, statusCommand, USAGE, type CliArgs } from './commands'

let args: CliArgs
try {
  args = parseCliArgs(process.argv.slice(2))
} catch (e) {
  console.error(`${(e as Error).message}\n${USAGE}`)
  process.exit(2)
}
try {
  process.loadEnvFile('.env')
} catch (e) {
  // No .env is fine for --mock and status; a broken one is not.
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
}

const deps = { env: process.env, log: (line: string) => console.log(line) }
let exitCode = 0
let store: EventStore | null = null
try {
  const config = loadStudyConfig(args.configPath)
  if (args.command === 'prereg') {
    await preregCommand(config, args.mock, deps)
  } else {
    mkdirSync(dirname(args.db), { recursive: true })
    store = new EventStore(args.db)
    if (args.command === 'status') {
      statusCommand(config, args.mock, store, deps)
    } else if (args.command === 'report') {
      reportCommand(config, args.mock, store, args.out ?? `reports/${config.id}${args.mock ? '-mock' : ''}`, deps)
    } else {
      const ac = new AbortController()
      process.on('SIGINT', () => {
        if (ac.signal.aborted) {
          console.log('quitting now; the study stays marked running: resume with --takeover')
          process.exit(130)
        }
        console.log('stopping after the hands in progress… (Ctrl-C again to quit now)')
        ac.abort()
      })
      const outcome = await runCommand(config, args.mock, store, { ...deps, signal: ac.signal, takeover: args.takeover })
      if (outcome.reason === 'budget_cap' || outcome.reason === 'interrupted') exitCode = 3
    }
  }
} catch (e) {
  console.error(`error: ${(e as Error).message}`)
  exitCode = 1
} finally {
  store?.close()
}
process.exit(exitCode)
```

Append to `.gitignore`:
```
reports/
```

- [ ] **Step 4: Run everything, then a free report**

Run: `pnpm test && pnpm typecheck`
Expected: PASS (engine 110, players 44, core 35, analysis 20, study 49); typecheck clean.

Then (free):
```bash
pnpm study run studies/smoke.example.json --mock --db data/report-check.db
pnpm study report studies/smoke.example.json --mock --db data/report-check.db --out data/report-check
```
Expected: the second command prints `study smoke-2026-09-mock: 40 hands, … decisions analysed in …` and writes `report.html`, `report.json`, `decisions.csv`, `decisions.json` under `data/report-check/`. Open `report.html` in a browser: nine sections, CI charts, reliability charts. Then delete `data/report-check*`.

- [ ] **Step 5: Commit**

```bash
git add apps/study .gitignore
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(study): pnpm study report writes the HTML report and JSON/CSV exports" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## After this plan

- `pnpm study report studies/<name>.json` produces the research write-up's numbers and charts from any study, mock or real, for free.
- Plan 4 (live server + web) reuses `@ab/analysis` for the site's `/research` page and live per-player calibration curves.
