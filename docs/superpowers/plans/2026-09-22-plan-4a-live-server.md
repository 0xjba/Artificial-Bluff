# artificialBluff Plan 4a: Live Server

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A headless live server for the spectator site: one live table (started by an admin, capped per game), replays of past live games and study highlights while idle, and a spectator feed with a ready-made table view and true-equity annotations. Ships `pnpm live [--mock]`.

**Architecture:** A pure table-view reducer in `@ab/core` (`applyEvent`) folds events into what a spectator sees; the server uses it for snapshots and Plan 4b's web UI will reuse it for live updates. `apps/server` (`@ab/server`) holds a `Hub` (current programme, view, subscribers, equity annotations), a `LiveController` (one `runTournamentGame` at a time, random secret deck seed), a `Director` (replays when idle, cuts to live at once, cooldown after), and a plain `node:http` API with a Server-Sent Events feed. `@ab/engine` gains a seeded equity estimate so the display never blocks on exact preflop enumeration.

**Tech Stack:** as before (TypeScript strict, Vitest, `tsx` at runtime: no build step), `node:http` + Server-Sent Events (no new dependencies).

**Spec:** `docs/superpowers/specs/2026-09-21-artificialbluff-design.md` §3 (event log as source of truth), §7 (live server, replays), §9 (errors: crash → interrupted, budget cap). Status/todos: `docs/STATUS.md`.

**Plan series:** 1 Engine → 2 Players, runner, event log → 3a Study runner → 3b Analysis and report (all merged) → **4a Live server (this)** → 4b Web UI (Broadcast) and mascots.

---

## Notes for the implementer

- **Money:** tests and `pnpm live --mock` are free (mock players, no keys, no network). A real `pnpm live` never spends anything until an admin starts a game (`POST /api/admin/games` with the token), and each game is capped by `LIVE_BUDGET_USD`. Never start a real game without the user's go-ahead.
- **Transport: Server-Sent Events, not WebSocket.** Spectators only receive; SSE is plain HTTP (no dependency, proxies and CDNs handle it, browsers reconnect by themselves). Every connection gets a `snapshot` (channel + full table view), then `event` and `equity` messages. A client resets its view on each snapshot (new programme or reconnect).
- **Secrets:** a live game's deck seed is 16 random bytes, never derived from the (public) game id. Seeds are published only once a game is over for good (`isOver`: ended, or an interrupted live game; an interrupted study can resume, so its master seed stays secret): until then `/api/games/:id` withholds the config and `/api/games/:id/events` answers 409, and study deck seeds in events are replaced by `WITHHELD_SEED` (-1). Hole cards are public (spectators see every hand; the players are programs that never read the feed).
- **Equity on screen:** each live player's chance of winning the main pot from here, given every dealt card (the study's outcome C). Exact when the remaining boards × players ≤ 200,000 evaluations (from the flop on); otherwise (preflop) a seeded 20,000-board estimate (±0.4 points), flagged `estimated`, so the event loop is never blocked for long. Research numbers stay exact. The reducer clears equity when a hand ends, so a connected client (applying events and equity messages) always equals the hub's view; a test checks this after every event.
- **Replays of studies:** parallel study tables interleave hands in the log; a highlight reel regroups each hand's events together (the reducer follows one hand at a time).
- **Config is strict:** numbers must be plain decimals (whole numbers where it matters), `MOCK` must be 0 or 1 (never silently paid), `ALLOWED_ORIGIN` must be a bare origin.
- **Programme:** a live game always wins: starting one interrupts the replay at once; its final result stays up for `COOLDOWN_MS`, then replays resume (past finished live games, newest first, alternating with study highlight reels). Highlights score chips won (bb), all-ins, and Jev and an LLM whose last stated chances of winning the same hand add up to more than 100%.
- **Admin:** off unless `ADMIN_TOKEN` (16+ characters) is set; constant-time comparison; stop takes effect after the hand in progress. CORS only for `ALLOWED_ORIGIN` (the web app in development).
- **Robustness:** only one server per database (`<db>.server.lock` with its pid; a stale lock is taken over), so a second server can never mark the first one's live game interrupted and publish its seed mid-game; live games (only live: a study may be running in another process) left `running` by a crash are marked `interrupted` at start-up; SIGINT/SIGTERM stop the live game after its hand, close connections, the store and the lock (Ctrl-C arrives twice, from the terminal and via tsx, so a repeat within 1 s is ignored; a later second signal quits at once); a malformed request target gets 400 (never an uncaught throw); a spectator that falls more than 1 MB behind is disconnected; the director logs and survives any error; finished games' events are served in pages of 5,000; a real line-up is checked at start-up (model catalog with a 15 s timeout, keys) so problems show before anyone presses start. (Final-review findings.)
- **Runtime:** `tsx` (the packages export TypeScript source; no build step), as for the CLIs. `pnpm server` is a pnpm built-in, hence `pnpm live`.

## File map

| File | Responsibility |
|---|---|
| `packages/engine/src/equity.ts` (modify) | `remainingBoards`, `sampleMainPotShares` (seeded estimate) |
| `packages/core/src/view.ts` | `TableView`, `applyEvent`, `buildView`, `withEquity` |
| `apps/server/src/config.ts` | `parseServerConfig` (environment + `--mock`) |
| `apps/server/src/public.ts` | `publicGame`, `publicEvent` (what spectators may see) |
| `apps/server/src/equity.ts` | `tableEquity` (exact or estimated), `equityKey` |
| `apps/server/src/hub.ts` | `Hub`: channel, view, subscribers, equity annotations |
| `apps/server/src/sleep.ts` | Abortable sleep |
| `apps/server/src/replay.ts` | Highlights, replay queue, `playReplay` |
| `apps/server/src/live.ts` | `LiveController` |
| `apps/server/src/director.ts` | `Director` (what is on screen) |
| `apps/server/src/players.ts` | Live line-up: mock or checked real players |
| `apps/server/src/http.ts` | HTTP API and SSE feed |
| `apps/server/src/app.ts`, `main.ts` | Wiring, start-up, shutdown; `pnpm live` |

---

### Task 1: Seeded equity estimate in the engine

**Files:**
- Modify: `packages/engine/src/equity.ts`
- Test: `packages/engine/test/equity.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace `packages/engine/test/equity.test.ts` with (adds the last two tests):
```ts
import { describe, expect, it } from 'vitest'
import type { Card } from '../src/cards'
import { mainPotShares, mainPotSharesBySubset, remainingBoards, sampleMainPotShares } from '../src/equity'
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

  it('estimates shares by seeded sampling, close to the exact answer and reproducible', () => {
    const holes = [cards('As Kd'), cards('Qh Qc'), cards('7s 6s'), cards('2d 2h'), cards('Jc Tc')]
    const exact = mainPotSharesBySubset(holes, cards('Jh 5c 2s'), [[0, 1, 2, 3, 4]])[0]!
    const sampled = sampleMainPotShares(holes, cards('Jh 5c 2s'), [0, 1, 2, 3, 4], 20_000, 7)
    sampled.forEach((v, i) => expect(Math.abs(v - exact[i]!)).toBeLessThan(0.015))
    expect(sampled.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
    expect(sampleMainPotShares(holes, cards('Jh 5c 2s'), [0, 1, 2, 3, 4], 20_000, 7)).toEqual(sampled)
    // Folded hands stay dead: the subset's shares match exact enumeration over the same live deck.
    const headsUp = sampleMainPotShares(holes, cards('Jh 5c 2s'), [1, 4], 20_000, 3)
    const exactHeadsUp = mainPotSharesBySubset(holes, cards('Jh 5c 2s'), [[1, 4]])[0]!
    headsUp.forEach((v, i) => expect(Math.abs(v - exactHeadsUp[i]!)).toBeLessThan(0.015))
    expect(sampleMainPotShares(holes, cards('Jh 5c 2s'), [0, 1, 2, 3, 4], 20_000, 8)).not.toEqual(sampled) // another seed, another sample
    expect(() => sampleMainPotShares(holes, [], [0, 1], 0, 1)).toThrow(/samples/)
    expect(() => sampleMainPotShares(holes, [], [0], 10, 1)).toThrow(/at least two players/)
  })

  it('counts the boards still to come', () => {
    expect(remainingBoards(4, 0)).toBe(1_712_304) // heads-up preflop: C(48, 5)
    expect(remainingBoards(10, 0)).toBe(850_668) // five players preflop: C(42, 5)
    expect(remainingBoards(13, 3)).toBe(741) // five players on the flop: C(39, 2)
    expect(remainingBoards(15, 5)).toBe(1)
    expect(() => remainingBoards(10, 2)).toThrow(/bad input/)
    expect(() => remainingBoards(3, 0)).toThrow(/bad input/)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ab/engine exec vitest run test/equity.test.ts`
Expected: FAIL (`sampleMainPotShares` / `remainingBoards` are not exported).

- [ ] **Step 3: Implement**

Replace `packages/engine/src/equity.ts` with (adds the `mulberry32` import, `remainingBoards` and `sampleMainPotShares`; the exact functions are unchanged):
```ts
/// <reference path="./phe.d.ts" />
import { cardCode, evaluateCardCodes } from 'phe'
import { fullDeck, isCard, type Card } from './cards'
import { mulberry32 } from './rng'

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

/** Checks a deal and its subsets (shared by the exact and sampled versions); returns every known card. */
function validateDeal(holes: readonly (readonly Card[])[], board: readonly Card[], subsets: readonly (readonly number[])[]): Card[] {
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
  return known
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
  const known = validateDeal(holes, board, subsets)

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

/** How many boards can still come, given the number of known cards (all hole cards plus the board). */
export function remainingBoards(knownCards: number, boardLength: number): number {
  if (![0, 3, 4, 5].includes(boardLength) || !Number.isInteger(knownCards) || knownCards < boardLength + 4 || knownCards > 52) {
    throw new Error(`remainingBoards: bad input (${knownCards} known cards, board of ${boardLength})`)
  }
  const rest = 52 - knownCards
  const k = 5 - boardLength
  let n = 1
  for (let i = 0; i < k; i++) n = (n * (rest - i)) / (i + 1)
  return Math.round(n)
}

/**
 * An estimate of mainPotSharesBySubset for one subset, from `samples` random boards drawn with a
 * seeded generator (reproducible). Every dealt hole card is dead. For on-screen display, where exact
 * preflop enumeration is too slow to do after every action; research numbers use the exact version.
 * With 20,000 samples the standard error is under 0.4 percentage points.
 */
export function sampleMainPotShares(holes: readonly (readonly Card[])[], board: readonly Card[], subset: readonly number[], samples: number, seed: number): number[] {
  if (!Number.isInteger(samples) || samples < 1) throw new Error('sampleMainPotShares: samples must be a positive integer')
  const known = validateDeal(holes, board, [subset])

  const code = (c: Card) => cardCode(c[0]!, c[1]!)
  const used = new Set(known)
  const rest = fullDeck().filter((c) => !used.has(c)).map(code)
  const holeCodes = subset.map((i) => holes[i]!.map(code))
  const missing = 5 - board.length
  const random = mulberry32(seed)
  const shares = new Array<number>(subset.length).fill(0)
  const values = new Array<number>(subset.length).fill(0)
  const cards = new Array<number>(7).fill(0)
  board.forEach((c, i) => (cards[i] = code(c)))
  const pool = [...rest]
  for (let s = 0; s < samples; s++) {
    // Partial Fisher-Yates: the first `missing` cards of the pool become the rest of the board.
    for (let i = 0; i < missing; i++) {
      const j = i + Math.floor(random() * (pool.length - i))
      const t = pool[i]!
      pool[i] = pool[j]!
      pool[j] = t
      cards[board.length + i] = pool[i]!
    }
    let best = Infinity
    let tied = 0
    for (let p = 0; p < holeCodes.length; p++) {
      cards[5] = holeCodes[p]![0]!
      cards[6] = holeCodes[p]![1]!
      const v = evaluateCardCodes(cards)
      values[p] = v
      if (v < best) {
        best = v
        tied = 1
      } else if (v === best) tied++
    }
    for (let p = 0; p < holeCodes.length; p++) if (values[p] === best) shares[p]! += 1 / tied
  }
  return shares.map((x) => x / samples)
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/engine exec vitest run && pnpm --filter @ab/engine typecheck`
Expected: PASS (112 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/engine
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(engine): seeded main-pot equity estimate for display" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Table view reducer in core

**Files:**
- Create: `packages/core/src/view.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/store.ts`
- Test: `packages/core/test/view.test.ts`, `packages/core/test/store.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/view.test.ts`:
```ts
import { liveTurboConfig } from '@ab/engine'
import { CallingStation, MockLlm, RandomBot, TagBot, type Player } from '@ab/players'
import { describe, expect, it } from 'vitest'
import type { GameEvent } from '../src/events'
import { runTournamentGame } from '../src/game'
import { EventStore } from '../src/store'
import { applyEvent, buildView, emptyView, withEquity, type TableView } from '../src/view'

const lineup = (): Player[] => [new MockLlm('jev'), new TagBot('pill'), new RandomBot('block', 7), new CallingStation('drip'), new MockLlm('nimbus', 'mock/llm', { failEvery: 9 })]

async function tournament(seed: string): Promise<GameEvent[]> {
  const store = new EventStore()
  await runTournamentGame({ gameId: 'g', players: lineup(), tournament: liveTurboConfig(seed), store, decisionTimeoutMs: 1000, budgetUsd: 100 })
  return store.events('g')
}

const chipsOnTable = (v: TableView) => v.seats.reduce((sum, s) => sum + s.stack, 0) + (v.hand && !v.hand.ended ? v.hand.pot : 0)

describe('table view', () => {
  it('tracks a whole tournament: turns, pots, stacks and chips stay consistent with the log', async () => {
    for (const seed of ['view-1', 'view-2', 'view-3']) {
      const events = await tournament(seed)
      let v = emptyView()
      for (const e of events) {
        if (e.type === 'decision') {
          // The view knows whose turn it is and the pot the player faced.
          expect(v.hand!.toAct).toBe(e.playerId)
          expect(v.hand!.options!.map((o) => o.id)).toContain(e.optionId)
          expect(v.hand!.pot).toBe(e.pot)
          expect(v.seats.find((s) => s.playerId === e.playerId)!.stack).toBeGreaterThanOrEqual(e.chipsIn)
        }
        v = applyEvent(v, e)
        if (v.status === 'running' && v.hand && !v.hand.ended && e.type !== 'pot_awarded') expect(chipsOnTable(v)).toBe(15_000)
        if (e.type === 'hand_ended') {
          for (const [id, stack] of Object.entries(e.stacks)) expect(v.seats.find((s) => s.playerId === id)!.stack).toBe(stack)
          expect(v.seats.every((s) => s.bet === 0)).toBe(true)
        }
        if (e.type === 'street_dealt') expect(v.seats.every((s) => s.bet === 0)).toBe(true)
      }
      const ended = events.at(-1) as Extract<GameEvent, { type: 'game_ended' }>
      expect(v).toMatchObject({ status: 'ended', gameId: 'g', kind: 'live', result: { reason: ended.reason, winner: ended.winner }, lastSeq: ended.seq })
      expect(v.handsPlayed).toBe(ended.handsPlayed)
      for (const id of ended.eliminated) expect(v.seats.find((s) => s.playerId === id)!.stack).toBe(0)
      // Running totals match the log.
      const decisions = events.filter((e): e is Extract<GameEvent, { type: 'decision' }> => e.type === 'decision')
      for (const s of v.seats) {
        const mine = decisions.filter((d) => d.playerId === s.playerId)
        expect(s.decisions).toBe(mine.length)
        expect(s.fallbacks).toBe(mine.filter((d) => d.fallback).length)
        expect(s.costUsd).toBeCloseTo(mine.reduce((sum, d) => sum + d.costUsd, 0), 12)
      }
      expect(buildView(events)).toEqual(v)
    }
  })

  it('shows hole cards, positions, the last action and decision, and marks eliminated seats out', async () => {
    const events = await tournament('view-4')
    const firstDecision = events.findIndex((e) => e.type === 'decision')
    const v = buildView(events.slice(0, firstDecision + 1))
    const d = events[firstDecision] as Extract<GameEvent, { type: 'decision' }>
    expect(v.seats.every((s) => s.hole?.length === 2 && s.position !== null)).toBe(true)
    expect(v.lastDecision).toMatchObject({ playerId: d.playerId, optionId: d.optionId, label: d.label, winProbability: d.winProbability })
    expect(v.seats.find((s) => s.playerId === d.playerId)!.lastAction).toEqual({ street: 'preflop', optionId: d.optionId, label: d.label })
    // After the first elimination, the next hand deals that seat out.
    const out = events.findIndex((e) => e.type === 'hand_started' && e.seats.length < 5)
    if (out >= 0) {
      const later = buildView(events.slice(0, out + 1))
      const missing = later.seats.filter((s) => s.status === 'out')
      expect(missing.length).toBe(5 - (events[out] as Extract<GameEvent, { type: 'hand_started' }>).seats.length)
      expect(missing.every((s) => s.position === null && s.hole === null)).toBe(true)
    }
  })

  it('never modifies the view it is given, and keeps the equity annotation until the hand ends', async () => {
    const events = await tournament('view-5')
    let v = emptyView()
    for (const e of events.slice(0, 40)) {
      const before = JSON.stringify(v)
      const next = applyEvent(v, e)
      expect(JSON.stringify(v)).toBe(before)
      v = next
    }
    const annotated = withEquity(v, { jev: 0.5, pill: 0.5 }, true)
    expect(annotated.equity).toEqual({ jev: 0.5, pill: 0.5 })
    expect(annotated.equityEstimated).toBe(true)
    expect(withEquity(v, null, true).equityEstimated).toBe(false)
    expect(v.equity).toBeNull()
    const handEnd = events.findIndex((e, i) => i >= 40 && e.type === 'hand_ended')
    let w = annotated
    for (const e of events.slice(40, handEnd)) w = applyEvent(w, e)
    expect(w.equity).toEqual({ jev: 0.5, pill: 0.5 })
    expect(applyEvent(w, events[handEnd]!)).toMatchObject({ equity: null, equityEstimated: false })
  })

  it("keeps each hand's own seat order, and closes an open hand when the game stops mid-hand", async () => {
    const events = await tournament('view-6')
    const started = events.find((e): e is Extract<GameEvent, { type: 'hand_started' }> => e.type === 'hand_started')!
    const firstTurn = events.findIndex((e) => e.type === 'turn_started')
    const v = buildView(events.slice(0, firstTurn + 1))
    expect(v.hand!.seatOrder).toEqual(started.seats.map((s) => s.playerId))
    expect(v.hand!.toAct).not.toBeNull()
    const crashed = applyEvent(withEquity(v, { jev: 1 }), {
      type: 'game_ended', reason: 'interrupted', winner: null, stacks: {}, eliminated: [], handsPlayed: 0, gameId: 'g', seq: 9999, ts: 0,
    })
    expect(crashed).toMatchObject({ status: 'ended', equity: null, hand: { ended: true, toAct: null, options: null } })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/core exec vitest run test/view.test.ts`
Expected: FAIL (cannot resolve `../src/view`).

- [ ] **Step 3: Implement**

`packages/core/src/view.ts`:
```ts
import type { Card, EndReason, HandCategory, OptionId, Position, Street } from '@ab/engine'
import type { PlayerKind } from '@ab/players'
import type { FallbackKind, GameEvent, GameKind } from './events'

/** One seat as a spectator sees it. */
export interface SeatView {
  playerId: string
  kind: PlayerKind
  model: string
  /** Position in the current hand; null when not dealt in (eliminated). */
  position: Position | null
  stack: number
  /** Chips put in on the current street. */
  bet: number
  /** Chips put in this hand. */
  committed: number
  status: 'active' | 'folded' | 'all_in' | 'out'
  /** Hole cards this hand (spectators see everyone's); null when not dealt in. */
  hole: Card[] | null
  lastAction: { street: Street; optionId: OptionId; label: string } | null
  lastLatencyMs: number | null
  /** Running totals for the game. */
  costUsd: number
  decisions: number
  fallbacks: number
}

/** The most recent decision, for the on-screen lower third. */
export interface DecisionView {
  handId: string | null
  playerId: string
  street: Street
  optionId: OptionId
  label: string
  winProbability: number | null
  confidence: number | null
  optionProbabilities: Partial<Record<OptionId, number>> | null
  reasoning: string | null
  latencyMs: number
  costUsd: number
  fallback: boolean
  fallbackKind: FallbackKind | null
  fallbackReason: string | null
}

export interface HandView {
  handId: string | null
  /** Player ids in this hand's seat order (buttonIndex indexes it; study hands reseat every hand). */
  seatOrder: string[]
  buttonIndex: number
  smallBlind: number
  bigBlind: number
  board: Card[]
  /** Every chip committed this hand (all streets). */
  pot: number
  street: Street
  /** Whose turn it is, and the options they were offered. */
  toAct: string | null
  options: Array<{ id: OptionId; label: string }> | null
  showdown: Record<string, { category: HandCategory; label: string }> | null
  awards: Array<{ amount: number; winners: string[]; shares: Record<string, number> }>
  ended: boolean
}

export interface TableView {
  gameId: string | null
  kind: GameKind | null
  status: 'waiting' | 'running' | 'ended'
  /** Seats in the order the game announced them. */
  seats: SeatView[]
  hand: HandView | null
  handsPlayed: number
  lastDecision: DecisionView | null
  result: { reason: EndReason; winner: string | null; stacks: Record<string, number> } | null
  /**
   * Each live player's true chance of winning the main pot from here (all hole cards known), set by the
   * server with `withEquity` whenever the board or the live players change; null until computed, and
   * cleared by the reducer when the hand ends (so every client clears it at the same event).
   */
  equity: Record<string, number> | null
  /** True when `equity` is a sampled estimate (early streets) rather than exact. */
  equityEstimated: boolean
  /** seq of the last event applied (0 before any). */
  lastSeq: number
}

export function emptyView(): TableView {
  return { gameId: null, kind: null, status: 'waiting', seats: [], hand: null, handsPlayed: 0, lastDecision: null, result: null, equity: null, equityEstimated: false, lastSeq: 0 }
}

/**
 * Folds one event into the view and returns the new view (the input is not modified). Pure and fast,
 * so the server (snapshots) and the browser (live updates) build identical views from the same events.
 * A stream must start at its game_started event (it names the seats); events for unknown players throw.
 */
export function applyEvent(prev: TableView, e: GameEvent): TableView {
  const v: TableView = {
    ...prev,
    seats: prev.seats.map((s) => ({ ...s })),
    hand: prev.hand ? { ...prev.hand, board: [...prev.hand.board], awards: [...prev.hand.awards], seatOrder: [...prev.hand.seatOrder] } : null,
    lastSeq: e.seq,
  }
  const seat = (id: string) => {
    const s = v.seats.find((x) => x.playerId === id)
    if (!s) throw new Error(`view: event for unknown player ${id}`)
    return s
  }

  switch (e.type) {
    case 'game_started':
      return {
        ...emptyView(),
        gameId: e.gameId,
        kind: e.kind,
        status: 'running',
        lastSeq: e.seq,
        seats: e.players.map((p) => ({
          playerId: p.id,
          kind: p.kind,
          model: p.model,
          position: null,
          stack: 0,
          bet: 0,
          committed: 0,
          status: 'active',
          hole: null,
          lastAction: null,
          lastLatencyMs: null,
          costUsd: 0,
          decisions: 0,
          fallbacks: 0,
        })),
      }
    case 'hand_started': {
      const dealt = new Map(e.seats.map((s) => [s.playerId, s]))
      for (const s of v.seats) {
        const d = dealt.get(s.playerId)
        s.bet = 0
        s.committed = 0
        s.lastAction = null
        if (d) {
          s.position = d.position
          s.stack = d.stack
          s.status = 'active'
          s.hole = null
        } else {
          s.position = null
          s.status = 'out'
          s.hole = null
        }
      }
      for (const p of e.posts) {
        const s = seat(p.playerId)
        s.stack -= p.amount
        s.bet += p.amount
        s.committed += p.amount
        if (s.stack === 0) s.status = 'all_in'
      }
      v.hand = {
        handId: e.handId,
        seatOrder: e.seats.map((s) => s.playerId),
        buttonIndex: e.buttonIndex,
        smallBlind: e.smallBlind,
        bigBlind: e.bigBlind,
        board: [],
        pot: e.posts.reduce((sum, p) => sum + p.amount, 0),
        street: 'preflop',
        toAct: null,
        options: null,
        showdown: null,
        awards: [],
        ended: false,
      }
      v.equity = null
      v.equityEstimated = false
      return v
    }
    case 'cards_dealt':
      for (const [id, cards] of Object.entries(e.holes)) seat(id).hole = [...cards]
      return v
    case 'turn_started':
      if (v.hand) {
        v.hand.toAct = e.playerId
        v.hand.options = e.options.map((o) => ({ ...o }))
      }
      return v
    case 'decision': {
      const s = seat(e.playerId)
      s.stack -= e.chipsIn
      s.bet += e.chipsIn
      s.committed += e.chipsIn
      if (e.action.type === 'fold') s.status = 'folded'
      else if (s.stack === 0) s.status = 'all_in'
      s.lastAction = { street: e.street, optionId: e.optionId, label: e.label }
      s.lastLatencyMs = e.latencyMs
      s.costUsd += e.costUsd
      s.decisions++
      if (e.fallback) s.fallbacks++
      if (v.hand) {
        v.hand.pot += e.chipsIn
        v.hand.toAct = null
        v.hand.options = null
      }
      v.lastDecision = {
        handId: e.handId,
        playerId: e.playerId,
        street: e.street,
        optionId: e.optionId,
        label: e.label,
        winProbability: e.winProbability,
        confidence: e.confidence,
        optionProbabilities: e.optionProbabilities ? { ...e.optionProbabilities } : null,
        reasoning: e.reasoning,
        latencyMs: e.latencyMs,
        costUsd: e.costUsd,
        fallback: e.fallback,
        fallbackKind: e.fallbackKind,
        fallbackReason: e.fallbackReason,
      }
      return v
    }
    case 'street_dealt':
      if (v.hand) {
        v.hand.board = [...e.board]
        v.hand.street = e.street
      }
      for (const s of v.seats) s.bet = 0
      return v
    case 'showdown':
      if (v.hand) v.hand.showdown = Object.fromEntries(Object.entries(e.hands).map(([id, h]) => [id, { category: h.category, label: h.label }]))
      return v
    case 'pot_awarded':
      if (v.hand) v.hand.awards.push({ amount: e.amount, winners: [...e.winners], shares: { ...e.shares } })
      return v
    case 'hand_ended':
      for (const [id, stack] of Object.entries(e.stacks)) seat(id).stack = stack
      for (const s of v.seats) s.bet = 0
      if (v.hand) {
        v.hand.ended = true
        v.hand.toAct = null
        v.hand.options = null
      }
      v.equity = null
      v.equityEstimated = false
      v.handsPlayed++
      return v
    case 'game_ended':
      for (const [id, stack] of Object.entries(e.stacks)) seat(id).stack = stack
      v.status = 'ended'
      v.result = { reason: e.reason, winner: e.winner, stacks: { ...e.stacks } }
      // A game that stopped mid-hand (a crash) closes the open hand too.
      if (v.hand && !v.hand.ended) {
        v.hand.ended = true
        v.hand.toAct = null
        v.hand.options = null
      }
      v.equity = null
      v.equityEstimated = false
      return v
    default:
      return v
  }
}

/** Folds a whole event list, from an empty view. */
export function buildView(events: readonly GameEvent[]): TableView {
  return events.reduce(applyEvent, emptyView())
}

/** The view with the true-equity annotation set (see TableView.equity). */
export function withEquity(view: TableView, equity: Record<string, number> | null, estimated = false): TableView {
  return { ...view, equity: equity ? { ...equity } : null, equityEstimated: equity !== null && estimated }
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './view'
```

In `packages/core/src/store.ts`, replace `interruptRunningGames` (the live server must never interrupt a study another process is running) with:
```ts
  /**
   * Marks games left 'running' by a crash as 'interrupted' and returns their ids. Pass `kind` to touch
   * only that kind: the live server must never interrupt a study another process is running.
   */
  interruptRunningGames(now = Date.now(), kind?: GameKind): string[] {
    const rows = (kind
      ? this.db.prepare("UPDATE games SET status = 'interrupted', ended_at = ? WHERE status = 'running' AND kind = ? RETURNING id").all(now, kind)
      : this.db.prepare("UPDATE games SET status = 'interrupted', ended_at = ? WHERE status = 'running' RETURNING id").all(now)) as Array<{ id: string }>
    return rows.map((r) => r.id).sort()
  }
```
and replace `events` (paged reads for the API) with:
```ts
  /** A game's events in order, after `afterSeq`, at most `limit` of them (all by default). */
  events(gameId: string, afterSeq = 0, limit = -1): GameEvent[] {
    const rows = this.db
      .prepare('SELECT seq, ts, body_json FROM events WHERE game_id = ? AND seq > ? ORDER BY seq LIMIT ?')
      .all(gameId, afterSeq, limit) as Array<{ seq: number; ts: number; body_json: string }>
    return rows.map((r) => ({ ...(JSON.parse(r.body_json) as EventBody), gameId, seq: r.seq, ts: r.ts }) as GameEvent)
  }
```
In `packages/core/test/store.test.ts`, replace the test `it('marks games left running as interrupted', ...)` with:
```ts
  it('marks games left running as interrupted', () => {
    const store = new EventStore()
    store.createGame('a', 'live', {})
    store.createGame('b', 'live', {})
    store.setStatus('b', 'ended')
    store.createGame('s', 'study', {})
    // The live server interrupts only live games: a study may be running in another process.
    expect(store.interruptRunningGames(Date.now(), 'live')).toEqual(['a'])
    expect(store.game('a')!.status).toBe('interrupted')
    expect(store.game('s')!.status).toBe('running')
    expect(store.interruptRunningGames()).toEqual(['s'])
    expect(store.games('live').map((g) => g.id)).toEqual(['a', 'b'])
  })

  it('lets only one run claim a game unless it takes over', () => {
    const store = new EventStore()
    store.createGame('s', 'study', {})
    expect(() => store.claimGame('s')).toThrow(/already running/)
    store.setStatus('s', 'interrupted')
    store.claimGame('s')
    expect(store.game('s')).toMatchObject({ status: 'running', endedAt: null })
    expect(() => store.claimGame('s')).toThrow(/already running/)
    store.claimGame('s', true)
    expect(() => store.claimGame('nope')).toThrow(/no game/)
  })
```
and after the line `expect(store.events('g1', 1)).toHaveLength(1)` add:
```ts
    expect(store.events('g1', 0, 1).map((e) => e.seq)).toEqual([1])
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/core exec vitest run && pnpm --filter @ab/core typecheck`
Expected: PASS (39 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(core): table view reducer shared by server snapshots and the web UI" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Server package, config and public views

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/src/config.ts`, `apps/server/src/public.ts`, `apps/server/src/index.ts`
- Test: `apps/server/test/config.test.ts`, `apps/server/test/public.test.ts`

- [ ] **Step 1: Create the package and write the failing tests**

`apps/server/package.json`:
```json
{
  "name": "@ab/server",
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
    "@ab/analysis": "workspace:*",
    "@ab/core": "workspace:*",
    "@ab/engine": "workspace:*",
    "@ab/players": "workspace:*"
  }
}
```

`apps/server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Then run `pnpm install` (workspace links only; `pnpm install --offline` if it tries the network).

`apps/server/test/config.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseServerConfig } from '../src/config'

describe('parseServerConfig', () => {
  it('has safe defaults: local only, admin API off, $1 per live game', () => {
    expect(parseServerConfig({})).toMatchObject({
      port: 8787,
      host: '127.0.0.1',
      dbPath: 'data/live.db',
      adminToken: null,
      lineupPath: 'lineups/live.json',
      mock: false,
      liveBudgetUsd: 1,
      paceMs: 2500,
      allowedOrigin: null,
    })
  })

  it('reads the environment and --mock', () => {
    const c = parseServerConfig({ PORT: '9000', ADMIN_TOKEN: 'a-long-enough-token', LIVE_BUDGET_USD: '0.5', ALLOWED_ORIGIN: 'http://localhost:3000' }, ['--mock'])
    expect(c).toMatchObject({ port: 9000, adminToken: 'a-long-enough-token', liveBudgetUsd: 0.5, mock: true, allowedOrigin: 'http://localhost:3000' })
    expect(parseServerConfig({ MOCK: '1' }).mock).toBe(true)
  })

  it('rejects typos and weak tokens instead of guessing', () => {
    expect(() => parseServerConfig({ LIVE_BUDGET_USD: '1O' })).toThrow(/LIVE_BUDGET_USD must be a number/)
    expect(() => parseServerConfig({ LIVE_BUDGET_USD: '500' })).toThrow(/from 0.01 to 100/)
    expect(() => parseServerConfig({ ADMIN_TOKEN: 'short' })).toThrow(/at least 16 characters/)
    expect(() => parseServerConfig({}, ['--mok'])).toThrow(/unknown argument/)
    // The free/paid switch accepts only 0 or 1: "true" must not quietly mean paid mode.
    expect(() => parseServerConfig({ MOCK: 'true' })).toThrow(/MOCK must be 0 or 1/)
    expect(parseServerConfig({ MOCK: '0' }).mock).toBe(false)
    expect(() => parseServerConfig({ PORT: '8787.5' })).toThrow(/whole number/)
    expect(() => parseServerConfig({ PORT: '0x10' })).toThrow(/PORT/)
    expect(() => parseServerConfig({ MAX_CLIENTS: '1e3' })).toThrow(/MAX_CLIENTS/)
    expect(() => parseServerConfig({ ALLOWED_ORIGIN: 'http://localhost:3000/' })).toThrow(/origin/)
    expect(() => parseServerConfig({ ALLOWED_ORIGIN: '*' })).toThrow(/origin/)
    expect(() => parseServerConfig({ REPLAY_PACE_MS: '0' })).toThrow(/REPLAY_PACE_MS/) // would replay in a tight loop
  })
})
```

`apps/server/test/public.test.ts`:
```ts
import type { GameEvent, GameRow } from '@ab/core'
import { describe, expect, it } from 'vitest'
import { isOver, publicEvent, publicGame, WITHHELD_SEED } from '../src/public'

const row = (status: GameRow['status']): GameRow => ({ id: 'g', kind: 'live', createdAt: 1, status, config: { tournament: { seed: 'secret' } }, configHash: 'h', endedAt: null })

describe('public views', () => {
  it('withholds a config (its seeds reveal the cards to come) until the game is over for good', () => {
    expect(publicGame(row('running'))).toMatchObject({ id: 'g', configHash: 'h', config: null })
    expect(publicGame(row('ended')).config).toEqual({ tournament: { seed: 'secret' } })
    expect(publicGame(row('interrupted')).config).toEqual({ tournament: { seed: 'secret' } }) // live games never resume
    const study = (status: GameRow['status']): GameRow => ({ ...row(status), kind: 'study' })
    expect(isOver(study('interrupted'))).toBe(false) // a stopped study can be resumed: its master seed stays secret
    expect(publicGame(study('interrupted')).config).toBeNull()
    expect(publicGame(study('ended')).config).not.toBeNull()
  })

  it("withholds a study hand's deck seed until the game is over, and nothing else", () => {
    const e = {
      type: 'hand_started', handId: '0:0#1', buttonIndex: 0, smallBlind: 50, bigBlind: 100, seats: [], posts: [],
      duplicate: { groupIndex: 0, rotation: 0, order: 1, seed: 12345, attempt: 1 }, gameId: 's', seq: 1, ts: 0,
    } as GameEvent
    expect(publicEvent(e, false)).toMatchObject({ duplicate: { groupIndex: 0, seed: WITHHELD_SEED } })
    expect(publicEvent(e, true)).toBe(e)
    const dealt = { type: 'cards_dealt', handId: 'h', holes: { a: ['As', 'Kd'] }, gameId: 'g', seq: 2, ts: 0 } as GameEvent
    expect(publicEvent(dealt, false)).toBe(dealt) // spectators see every hole card
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ab/server exec vitest run`
Expected: FAIL (cannot resolve `../src/config`, `../src/public`).

- [ ] **Step 3: Implement**

`apps/server/src/config.ts`:
```ts
/** Server settings, from environment variables (and `--mock` on the command line). */
export interface ServerConfig {
  port: number
  host: string
  dbPath: string
  /** Bearer token for the admin API; null disables it (no way to start a paid game). */
  adminToken: string | null
  /** Line-up file for live games (ignored in mock mode). */
  lineupPath: string
  /** Free mode: every paid seat becomes a mock player. */
  mock: boolean
  /** Spending cap per live game (USD). */
  liveBudgetUsd: number
  /** Pause after each action in a live game, so spectators can follow. */
  paceMs: number
  decisionTimeoutMs: number
  /** Pause after each action when replaying. */
  replayPaceMs: number
  /** How long the final result of a live game stays on screen before replays resume. */
  cooldownMs: number
  /** Origin allowed to call the API from a browser (the web app in development), or null. */
  allowedOrigin: string | null
  /** Most spectator connections at once. */
  maxClients: number
}

type Env = Record<string, string | undefined>

function number(env: Env, key: string, fallback: number, min: number, max: number, integer = false): number {
  const raw = env[key]?.trim()
  if (raw === undefined || raw === '') return fallback
  const value = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${key} must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}, got "${env[key]}"`)
  }
  return value
}

function flag(env: Env, key: string): boolean {
  const raw = env[key]?.trim() ?? ''
  if (raw === '' || raw === '0') return false
  if (raw === '1') return true
  throw new Error(`${key} must be 0 or 1, got "${env[key]}"`)
}

function origin(env: Env, key: string): string | null {
  const raw = env[key]?.trim() || null
  if (raw !== null && !/^https?:\/\/[^/\s*]+$/.test(raw)) throw new Error(`${key} must be an origin like http://localhost:3000 (no path, no trailing slash, no *), got "${raw}"`)
  return raw
}

/** Reads the server settings; throws on a malformed value so a typo can't silently change behaviour. */
export function parseServerConfig(env: Env, argv: readonly string[] = []): ServerConfig {
  const unknown = argv.filter((a) => a !== '--mock')
  if (unknown.length) throw new Error(`unknown argument(s): ${unknown.join(' ')} (usage: pnpm live [--mock])`)
  const token = env.ADMIN_TOKEN?.trim() || null
  if (token !== null && token.length < 16) throw new Error('ADMIN_TOKEN must be at least 16 characters (or unset to disable the admin API)')
  return {
    port: number(env, 'PORT', 8787, 0, 65_535, true),
    host: env.HOST?.trim() || '127.0.0.1',
    dbPath: env.DB_PATH?.trim() || 'data/live.db',
    adminToken: token,
    lineupPath: env.LINEUP?.trim() || 'lineups/live.json',
    mock: argv.includes('--mock') || flag(env, 'MOCK'),
    liveBudgetUsd: number(env, 'LIVE_BUDGET_USD', 1, 0.01, 100),
    paceMs: number(env, 'PACE_MS', 2500, 0, 60_000, true),
    decisionTimeoutMs: number(env, 'DECISION_TIMEOUT_MS', 20_000, 1000, 300_000, true),
    replayPaceMs: number(env, 'REPLAY_PACE_MS', 1500, 10, 60_000, true), // 0 would replay in a tight loop
    cooldownMs: number(env, 'COOLDOWN_MS', 30_000, 0, 600_000, true),
    allowedOrigin: origin(env, 'ALLOWED_ORIGIN'),
    maxClients: number(env, 'MAX_CLIENTS', 500, 1, 100_000, true),
  }
}
```

`apps/server/src/public.ts`:
```ts
import type { GameEvent, GameRow } from '@ab/core'

/** What the public API says about a game. */
export interface PublicGame {
  id: string
  kind: GameRow['kind']
  status: GameRow['status']
  createdAt: number
  endedAt: number | null
  configHash: string
  /**
   * The full config (seeds included) once the game is over for good (see isOver), so anyone can check
   * it against the hash and replay the decks. Withheld until then: seeds reveal every card still to come.
   */
  config: unknown | null
}

/**
 * Whether a game is over for good, so its seeds can be published: an ended game, or an interrupted live
 * game (live games never resume). An interrupted study can be resumed, so its master seed stays secret.
 */
export function isOver(row: GameRow): boolean {
  return row.status === 'ended' || (row.kind === 'live' && row.status === 'interrupted')
}

export function publicGame(row: GameRow): PublicGame {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    createdAt: row.createdAt,
    endedAt: row.endedAt,
    configHash: row.configHash,
    config: isOver(row) ? row.config : null,
  }
}

/** Stands in for a withheld deck seed (real seeds are unsigned 32-bit integers). */
export const WITHHELD_SEED = -1

/**
 * An event as spectators may see it. Hole cards are public (spectators see every hand; the players are
 * programs that never read the feed). Until a game is over, a study hand's deck seed is withheld.
 */
export function publicEvent(e: GameEvent, over: boolean): GameEvent {
  if (!over && e.type === 'hand_started' && e.duplicate) return { ...e, duplicate: { ...e.duplicate, seed: WITHHELD_SEED } }
  return e
}
```

`apps/server/src/index.ts`:
```ts
export * from './config'
export * from './public'
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/server exec vitest run && pnpm --filter @ab/server typecheck`
Expected: PASS (5 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server pnpm-lock.yaml
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(server): server config and public game/event views" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Hub and true-equity annotations

**Files:**
- Create: `apps/server/src/equity.ts`, `apps/server/src/hub.ts`
- Modify: `apps/server/src/index.ts`
- Test: `apps/server/test/hub.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/server/test/hub.test.ts`:
```ts
import { applyEvent, buildView, emptyView, EventStore, runTournamentGame, withEquity, type GameEvent, type TableView } from '@ab/core'
import { liveTurboConfig } from '@ab/engine'
import { CallingStation, MockLlm, TagBot } from '@ab/players'
import { describe, expect, it } from 'vitest'
import { Hub, type FeedMessage } from '../src/hub'

async function liveGame(hub: Hub, maxHands = 6): Promise<GameEvent[]> {
  const store = new EventStore()
  const players = [new MockLlm('jev'), new TagBot('pill'), new MockLlm('block'), new CallingStation('drip'), new MockLlm('nimbus')]
  hub.begin({ mode: 'live', title: 'LIVE', gameId: 'g' })
  await runTournamentGame({
    gameId: 'g', players, tournament: { ...liveTurboConfig('hub'), maxHands }, store, decisionTimeoutMs: 1000, budgetUsd: 100,
    onEvent: (e) => hub.publish(e),
  })
  return store.events('g')
}

describe('Hub', () => {
  it('sends a snapshot on subscribe, then every event, and builds the same view as the log', async () => {
    const hub = new Hub()
    const got: FeedMessage[] = []
    hub.subscribe((m) => got.push(m))
    expect(got[0]).toMatchObject({ type: 'snapshot', channel: { mode: 'idle' } })
    const events = await liveGame(hub)
    expect(got[1]).toMatchObject({ type: 'snapshot', channel: { mode: 'live', title: 'LIVE', gameId: 'g' } })
    const sent = got.filter((m): m is Extract<FeedMessage, { type: 'event' }> => m.type === 'event').map((m) => m.event)
    expect(sent).toEqual(events)
    const { view } = hub.current()
    expect(view).toEqual(buildView(events)) // the game has ended: no equity left on either side
    // A late subscriber starts from the same view.
    const late: FeedMessage[] = []
    hub.subscribe((m) => late.push(m))
    expect(late).toEqual([{ type: 'snapshot', channel: hub.current().channel, view }])
  })

  it('keeps a connected client exactly in step with the hub, equity included', async () => {
    const hub = new Hub()
    let client: TableView = emptyView()
    let mismatches = 0
    hub.subscribe((m) => {
      if (m.type === 'snapshot') client = m.view
      else if (m.type === 'event') client = applyEvent(client, m.event)
      else client = withEquity(client, m.equity, m.estimated)
    })
    const store = new EventStore()
    const players = [new MockLlm('jev'), new TagBot('pill'), new MockLlm('block'), new CallingStation('drip'), new MockLlm('nimbus')]
    hub.begin({ mode: 'live', title: 'LIVE', gameId: 'g' })
    await runTournamentGame({
      gameId: 'g', players, tournament: { ...liveTurboConfig('step'), maxHands: 8 }, store, decisionTimeoutMs: 1000, budgetUsd: 100,
      onEvent: (e) => {
        hub.publish(e)
        if (JSON.stringify(client) !== JSON.stringify(hub.current().view)) mismatches++
      },
    })
    expect(mismatches).toBe(0)
  })

  it('does not send an event twice to someone who subscribes while it is being broadcast', () => {
    const hub = new Hub()
    hub.begin({ mode: 'live', title: 'LIVE', gameId: 'g' })
    const late: string[] = []
    let added = false
    hub.subscribe((m) => {
      if (m.type !== 'event' || added) return
      added = true
      hub.subscribe((m) => late.push(m.type))
    })
    hub.publish({ type: 'game_started', kind: 'live', configHash: 'h', players: [{ id: 'a', kind: 'bot', model: 'bot/tag' }], gameId: 'g', seq: 1, ts: 0 })
    expect(late).toEqual(['snapshot']) // the snapshot already includes the event
  })

  it('annotates true equity whenever the board or the live players change', async () => {
    const hub = new Hub()
    const got: FeedMessage[] = []
    hub.subscribe((m) => got.push(m))
    await liveGame(hub, 3)
    const equity = got.filter((m): m is Extract<FeedMessage, { type: 'equity' }> => m.type === 'equity')
    expect(equity.length).toBeGreaterThan(3)
    for (const m of equity.filter((x) => x.equity)) {
      expect(Object.values(m.equity!).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    }
    // Consecutive annotations differ (no repeats for the same board and players).
    const keys = equity.map((m) => JSON.stringify(m))
    keys.slice(1).forEach((k, i) => expect(k).not.toBe(keys[i]))
  })

  it('drops a subscriber that throws, without disturbing the others', async () => {
    const hub = new Hub()
    const good: FeedMessage[] = []
    hub.subscribe(() => {
      throw new Error('socket closed')
    })
    hub.subscribe((m) => good.push(m))
    expect(hub.clientCount).toBe(1)
    await liveGame(hub, 2)
    expect(good.filter((m) => m.type === 'event').length).toBeGreaterThan(10)
    const unsubscribe = hub.subscribe(() => undefined)
    expect(hub.clientCount).toBe(2)
    unsubscribe()
    expect(hub.clientCount).toBe(1)
  })

  it('starts each programme from an empty view with a new channel id', () => {
    const hub = new Hub()
    const a = hub.begin({ mode: 'replay', title: 'REPLAY', gameId: 'x' })
    const b = hub.idle()
    expect(a.id).not.toBe(b.id)
    expect(hub.current()).toMatchObject({ channel: { mode: 'idle', gameId: null }, view: { status: 'waiting', seats: [] } })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/server exec vitest run test/hub.test.ts`
Expected: FAIL (cannot resolve `../src/hub`).

- [ ] **Step 3: Implement**

`apps/server/src/equity.ts`:
```ts
import type { TableView } from '@ab/core'
import { deriveSeed, mainPotSharesBySubset, remainingBoards, sampleMainPotShares, type Card } from '@ab/engine'

/** Above this many hand evaluations, the on-screen equity is sampled instead of enumerated. */
export const EXACT_EVALUATION_LIMIT = 200_000
/** Boards sampled for an estimate (standard error under 0.4 percentage points). */
export const EQUITY_SAMPLES = 20_000

export interface TableEquity {
  equity: Record<string, number>
  /** True for a sampled estimate. */
  estimated: boolean
}

/**
 * Each live player's true chance of winning the main pot from here, given every dealt hole card and
 * the board (the same quantity as the study's outcome C). Exact when that is cheap (from the flop on);
 * otherwise (preflop) a reproducible 20,000-board estimate, so the event loop is never blocked for long. Null when there is no hand in progress or fewer than two players are still in.
 */
export function tableEquity(view: TableView): TableEquity | null {
  const hand = view.hand
  if (!hand || hand.ended || ![0, 3, 4, 5].includes(hand.board.length)) return null
  const dealt = view.seats.filter((s) => s.hole !== null && s.status !== 'out')
  if (dealt.length < 2) return null
  const live = dealt.map((s, i) => ({ s, i })).filter(({ s }) => s.status !== 'folded')
  if (live.length < 2) return null
  const holes = dealt.map((s) => s.hole as Card[])
  const subset = live.map(({ i }) => i)
  const evaluations = remainingBoards(dealt.length * 2 + hand.board.length, hand.board.length) * subset.length
  const estimated = evaluations > EXACT_EVALUATION_LIMIT
  const shares = estimated
    ? sampleMainPotShares(holes, hand.board, subset, EQUITY_SAMPLES, deriveSeed('equity', view.gameId ?? '', hand.handId ?? '', hand.board.join(''), subset.join(',')))
    : mainPotSharesBySubset(holes, hand.board, [subset])[0]!
  return { equity: Object.fromEntries(live.map(({ s }, j) => [s.playerId, shares[j]!])), estimated }
}
/** Cache key of what equity depends on: the hand, the board and who is still in. */
export function equityKey(view: TableView): string | null {
  const hand = view.hand
  if (!hand || hand.ended) return null
  const live = view.seats.filter((s) => s.hole !== null && s.status !== 'out' && s.status !== 'folded').map((s) => s.playerId)
  return `${view.gameId}/${hand.handId}/${hand.board.join('')}/${live.join(',')}`
}
```

`apps/server/src/hub.ts`:
```ts
import { applyEvent, emptyView, withEquity, type GameEvent, type TableView } from '@ab/core'
import { equityKey, tableEquity } from './equity'

/** What spectators are watching. */
export interface Channel {
  /** Changes whenever the programme changes (a new live game, the next replay). */
  id: string
  mode: 'idle' | 'live' | 'replay'
  /** Shown on screen, e.g. "LIVE" or "REPLAY · study main-2026-09, hand 12:3". */
  title: string
  gameId: string | null
}

/** Messages on the spectator feed. A client resets its view on every snapshot. */
export type FeedMessage =
  | { type: 'snapshot'; channel: Channel; view: TableView }
  | { type: 'event'; channelId: string; event: GameEvent }
  | { type: 'equity'; channelId: string; handId: string | null; equity: Record<string, number> | null; estimated: boolean }

export type Subscriber = (message: FeedMessage) => void

/**
 * The one programme everyone watches: the current channel, its table view (built from the events
 * published so far) and the subscribers. New subscribers get a snapshot, then every message.
 */
export class Hub {
  private channel: Channel = { id: 'idle-0', mode: 'idle', title: 'Waiting for the next game', gameId: null }
  private view: TableView = emptyView()
  private readonly subscribers = new Set<Subscriber>()
  private lastEquityKey: string | null = null
  private counter = 0

  /** Starts a new programme: resets the view and sends everyone a snapshot. */
  begin(channel: Omit<Channel, 'id'>): Channel {
    this.channel = { ...channel, id: `${channel.mode}-${++this.counter}` }
    this.view = emptyView()
    this.lastEquityKey = null
    this.broadcast(this.snapshot())
    return this.channel
  }

  /** Back to idle (e.g. between a live game and the next replay). */
  idle(title = 'Waiting for the next game'): Channel {
    return this.begin({ mode: 'idle', title, gameId: null })
  }

  /**
   * Adds an event to the current programme; recomputes true equity when the board or live players
   * change. Clients apply the same event with applyEvent and each equity message with withEquity, so
   * their view always equals the hub's (the reducer itself clears equity when a hand ends).
   */
  publish(event: GameEvent): void {
    this.view = applyEvent(this.view, event)
    this.broadcast({ type: 'event', channelId: this.channel.id, event })
    const key = equityKey(this.view)
    if (key !== this.lastEquityKey) {
      this.lastEquityKey = key
      if (key !== null) {
        const result = tableEquity(this.view)
        this.view = withEquity(this.view, result?.equity ?? null, result?.estimated ?? false)
        this.broadcast({ type: 'equity', channelId: this.channel.id, handId: this.view.hand?.handId ?? null, equity: this.view.equity, estimated: this.view.equityEstimated })
      }
    }
  }

  snapshot(): FeedMessage {
    return { type: 'snapshot', channel: { ...this.channel }, view: this.view }
  }

  current(): { channel: Channel; view: TableView } {
    return { channel: { ...this.channel }, view: this.view }
  }

  /** Adds a subscriber and sends it the snapshot; returns the unsubscribe function. */
  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    this.safeSend(fn, this.snapshot())
    return () => this.subscribers.delete(fn)
  }

  get clientCount(): number {
    return this.subscribers.size
  }

  private broadcast(message: FeedMessage): void {
    // A copy: someone subscribing mid-broadcast gets a snapshot that already includes this message.
    for (const fn of [...this.subscribers]) this.safeSend(fn, message)
  }

  /** A subscriber that throws (a broken connection) is dropped; it never stops the game. */
  private safeSend(fn: Subscriber, message: FeedMessage): void {
    try {
      fn(message)
    } catch {
      this.subscribers.delete(fn)
    }
  }
}
```

`apps/server/src/index.ts`:
```ts
export * from './config'
export * from './public'
export * from './equity'
export * from './hub'
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/server exec vitest run && pnpm --filter @ab/server typecheck`
Expected: PASS (11 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(server): spectator hub with snapshots and true-equity annotations" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Replays and highlights

**Files:**
- Create: `apps/server/src/sleep.ts`, `apps/server/src/replay.ts`
- Modify: `apps/server/src/index.ts`
- Test: `apps/server/test/fixtures.ts`, `apps/server/test/replay.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/server/test/fixtures.ts` (shared by later tests):
```ts
import { EventStore, runTournamentGame, type GameEvent } from '@ab/core'
import { liveTurboConfig } from '@ab/engine'
import { CallingStation, MockLlm, TagBot, type Player } from '@ab/players'

export const mockPlayers = (): Player[] => [new MockLlm('jev', 'mock/jev'), new TagBot('pill'), new MockLlm('block'), new CallingStation('drip'), new MockLlm('nimbus')]

/** Plays a short free live game into `store` and returns its events. */
export async function playLiveGame(store: EventStore, gameId: string, maxHands = 6): Promise<GameEvent[]> {
  await runTournamentGame({ gameId, players: mockPlayers(), tournament: { ...liveTurboConfig(gameId), maxHands }, store, decisionTimeoutMs: 1000, budgetUsd: 100 })
  return store.events(gameId)
}
```

`apps/server/test/replay.test.ts`:
```ts
import type { HandRecord } from '@ab/analysis'
import { buildView, EventStore, type GameEvent, type PlayerInfo } from '@ab/core'
import { describe, expect, it } from 'vitest'
import { Hub, type FeedMessage } from '../src/hub'
import { highlightReel, highlightScore, playReplay, replayDelay, replayQueue } from '../src/replay'
import { playLiveGame } from './fixtures'

function hand(over: Partial<HandRecord>): HandRecord {
  return { handId: 'h', bigBlind: 100, seats: [], holes: {}, board: [], decisions: [], folded: [], sawFlop: [], showdown: [], mainPotWinners: [], net: {}, ...over }
}
const said = (playerId: string, winProbability: number, optionId = 'call') =>
  ({ playerId, winProbability, optionId, fallback: false }) as unknown as HandRecord['decisions'][number]

describe('highlights', () => {
  const kinds = new Map<string, PlayerInfo>([
    ['jev', { id: 'jev', kind: 'jev', model: 'jev-1' }],
    ['pill', { id: 'pill', kind: 'llm', model: 'x/y' }],
    ['drip', { id: 'drip', kind: 'llm', model: 'x/z' }],
  ])

  it('scores chips won, all-ins, and Jev and an LLM both claiming the pot', () => {
    expect(highlightScore(hand({ net: { a: 500, b: -500 } }), kinds)).toBe(5)
    expect(highlightScore(hand({ net: { a: 500, b: -500 }, decisions: [said('pill', 0.5, 'all_in')] }), kinds)).toBe(30)
    // Jev says 80%, pill says 70%: 50 points over 100% between them (their last statements count).
    const clash = hand({ decisions: [said('jev', 0.3), said('pill', 0.7), said('jev', 0.8), said('drip', 0.1)] })
    expect(highlightScore(clash, kinds)).toBeCloseTo(50, 9)
    // Two LLMs disagreeing, or a coherent pair, add nothing.
    expect(highlightScore(hand({ decisions: [said('pill', 0.9), said('drip', 0.9)] }), kinds)).toBe(0)
    expect(highlightScore(hand({ decisions: [said('jev', 0.4), said('pill', 0.5)] }), kinds)).toBe(0)
  })

  it('makes a reel of the best hands of a game, in play order, after its game_started', async () => {
    const events = await playLiveGame(new EventStore(), 'g', 10)
    const reel = highlightReel(events, 3, 'best of g')!
    expect(reel.title).toBe('best of g')
    expect(reel.events[0]!.type).toBe('game_started')
    const starts = reel.events.filter((e) => e.type === 'hand_started').map((e) => (e as { handId: string }).handId)
    expect(starts).toHaveLength(3)
    expect([...starts].sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]))).toEqual(starts)
    expect(highlightReel([], 3, 'x')).toBeNull()
  })

  it('keeps each hand of a reel together even when the log interleaves hands (parallel study tables)', async () => {
    const a = await playLiveGame(new EventStore(), 'g', 4)
    const started = a[0]!
    const hands = new Map<string, GameEvent[]>()
    for (const e of a.slice(1)) {
      if (!('handId' in e) || e.handId === null) continue
      hands.set(e.handId, [...(hands.get(e.handId) ?? []), e])
    }
    // Interleave the hands' events round-robin, as parallel tables would log them.
    const lists = [...hands.values()]
    const mixed: GameEvent[] = [started]
    for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) mixed.push(l[i]!)
    const reel = highlightReel(mixed, 3, 'reel')!
    const order = reel.events.slice(1).map((e) => (e as { handId: string }).handId)
    const runs = order.filter((id, i) => i === 0 || id !== order[i - 1])
    expect(runs).toHaveLength(3) // three hands, each in one unbroken run
    expect(new Set(runs).size).toBe(3)
    expect(buildView(reel.events).handsPlayed).toBe(3) // and the reducer can follow it
  })

  it('alternates finished live games (newest first) with study reels, and skips unfinished games', async () => {
    const store = new EventStore()
    await playLiveGame(store, 'old', 3)
    await playLiveGame(store, 'new', 3)
    store.db.prepare("UPDATE games SET created_at = 1 WHERE id = 'old'").run()
    store.createGame('broken', 'live', {})
    store.setStatus('broken', 'interrupted')
    const study = await playLiveGame(new EventStore(), 'study-src', 4)
    store.createGame('st', 'study', {})
    for (const { gameId: _g, seq: _s, ts: _t, ...body } of study) store.append('st', body as never)
    store.setStatus('st', 'ended')
    store.createGame('resumable', 'study', {})
    store.setStatus('resumable', 'interrupted') // a stopped study can still resume: not replayed
    const cache = new Map()
    const queue = replayQueue(store, {}, cache)
    expect(queue.map((q) => q.title)).toEqual(['REPLAY · live game new', 'REPLAY · study st highlights', 'REPLAY · live game old'])
    expect(queue[1]!.events.every((e) => e.gameId === 'st')).toBe(true)
    // A stopped live game is over for good, so it is replayed too; built games come from the cache.
    await playLiveGame(store, 'stopped', 2)
    store.setStatus('stopped', 'interrupted')
    store.db.prepare("UPDATE games SET created_at = 0 WHERE id = 'stopped'").run()
    let reads = 0
    const events = store.events.bind(store)
    store.events = (...args: Parameters<typeof store.events>) => (reads++, events(...args))
    const again = replayQueue(store, {}, cache)
    expect(again.map((q) => q.gameId)).toEqual(['new', 'st', 'old', 'stopped'])
    expect(reads).toBe(1) // only the new game's log was read
  })
})

describe('playReplay', () => {
  it('plays every event at spectator pace on a replay channel', async () => {
    const events = await playLiveGame(new EventStore(), 'g', 2)
    const hub = new Hub()
    const got: FeedMessage[] = []
    hub.subscribe((m) => got.push(m))
    const waits: number[] = []
    const done = await playReplay(hub, { title: 'REPLAY · g', gameId: 'g', events }, { paceMs: 100, sleep: async (ms) => void waits.push(ms) })
    expect(done).toBe(true)
    expect(got[1]).toMatchObject({ type: 'snapshot', channel: { mode: 'replay', title: 'REPLAY · g', gameId: 'g' } })
    expect(got.filter((m) => m.type === 'event').map((m) => (m as { event: GameEvent }).event)).toEqual(events)
    expect(waits).toEqual(events.map((e) => replayDelay(e, 100)).filter((ms) => ms > 0))
    expect(replayDelay(events.find((e) => e.type === 'decision')!, 100)).toBe(100)
  })

  it('stops as soon as it is interrupted', async () => {
    const events = await playLiveGame(new EventStore(), 'g', 3)
    const hub = new Hub()
    let published = 0
    hub.subscribe((m) => void (m.type === 'event' && published++))
    const ac = new AbortController()
    let decisions = 0
    const done = await playReplay(hub, { title: 't', gameId: 'g', events }, {
      paceMs: 10,
      signal: ac.signal,
      sleep: async () => {
        if (++decisions === 5) ac.abort()
      },
    })
    expect(done).toBe(false)
    expect(published).toBeLessThan(events.length)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/server exec vitest run test/replay.test.ts`
Expected: FAIL (cannot resolve `../src/replay`).

- [ ] **Step 3: Implement**

`apps/server/src/sleep.ts`:
```ts
/** Waits `ms`, resolving early (without error) if `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted || ms <= 0) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

export type Sleep = typeof sleep
```

`apps/server/src/replay.ts`:
```ts
import { extractHands, playerInfo, type HandRecord } from '@ab/analysis'
import type { EventStore, GameEvent, PlayerInfo } from '@ab/core'
import type { Hub } from './hub'
import { isOver, publicEvent } from './public'
import { sleep as realSleep, type Sleep } from './sleep'

/** One programme for the idle screen: a whole past live game, or a reel of study highlights. */
export interface ReplayItem {
  title: string
  gameId: string
  events: GameEvent[]
}

/**
 * How watchable a hand is: the chips won (in big blinds), a bonus for an all-in, and a bonus for a
 * Jev-vs-LLM disagreement: Jev and an LLM both in the hand whose last stated chances of winning it add
 * up to more than 100% (they can't both win, so at least one is badly wrong).
 */
export function highlightScore(hand: HandRecord, players: Map<string, PlayerInfo>): number {
  const wonBb = Object.values(hand.net).reduce((sum, n) => sum + Math.max(0, n), 0) / hand.bigBlind
  const allIn = hand.decisions.some((d) => d.optionId === 'all_in') ? 25 : 0
  const lastSaid = new Map<string, number>()
  for (const d of hand.decisions) if (d.winProbability !== null && !d.fallback) lastSaid.set(d.playerId, d.winProbability)
  let clash = 0
  for (const [jev, pj] of lastSaid) {
    if (players.get(jev)?.kind !== 'jev') continue
    for (const [llm, pl] of lastSaid) if (players.get(llm)?.kind === 'llm') clash = Math.max(clash, pj + pl - 1)
  }
  return wonBb + allIn + 100 * clash
}

/**
 * The `limit` most watchable hands of a game as one replay: game_started, then each hand's events in
 * full, hand after hand, in the order the hands started.
 */
export function highlightReel(events: readonly GameEvent[], limit: number, title: string): ReplayItem | null {
  const started = events.find((e) => e.type === 'game_started')
  if (!started) return null
  const info = playerInfo(events)
  const best = extractHands(events)
    .map((h) => ({ id: h.handId, score: highlightScore(h, info) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  if (best.length === 0) return null
  const keep = new Set(best.map((b) => b.id))
  // One hand after another: a study with parallel tables logs several hands' events interleaved.
  const byHand = new Map<string, GameEvent[]>()
  for (const e of events) {
    if (!('handId' in e) || e.handId === null || !keep.has(e.handId)) continue
    const list = byHand.get(e.handId)
    if (list) list.push(e)
    else byHand.set(e.handId, [e])
  }
  return { title, gameId: started.gameId, events: [started, ...[...byHand.values()].flat()] }
}

/** Replays already built, by game id (games that are over never change). */
export type ReplayCache = Map<string, ReplayItem | null>

/**
 * What to show when no live game is on: the latest past live games (whole; stopped or crashed ones
 * too) alternating with highlight reels of finished studies. Only games that are over for good are
 * replayed (see isOver). Pass a cache to avoid re-reading their logs every round.
 */
export function replayQueue(store: EventStore, opts: { liveGames?: number; studies?: number; handsPerReel?: number } = {}, cache: ReplayCache = new Map()): ReplayItem[] {
  const newestFirst = <T extends { createdAt: number }>(rows: T[]) => [...rows].sort((a, b) => b.createdAt - a.createdAt)
  const cached = (id: string, build: () => ReplayItem | null) => {
    if (!cache.has(id)) cache.set(id, build())
    return cache.get(id)!
  }
  const live = newestFirst(store.games('live').filter(isOver))
    .slice(0, opts.liveGames ?? 5)
    .map((g) =>
      cached(g.id, () => {
        const events = store.events(g.id)
        return events.some((e) => e.type === 'hand_ended') ? { title: `REPLAY · live game ${g.id}`, gameId: g.id, events } : null
      }),
    )
    .filter((item): item is ReplayItem => item !== null)
  const studies = newestFirst(store.games('study').filter(isOver))
    .slice(0, opts.studies ?? 3)
    .map((g) => cached(g.id, () => highlightReel(store.events(g.id), opts.handsPerReel ?? 8, `REPLAY · study ${g.id} highlights`)))
    .filter((item): item is ReplayItem => item !== null)
  const queue: ReplayItem[] = []
  for (let i = 0; i < Math.max(live.length, studies.length); i++) {
    if (live[i]) queue.push(live[i]!)
    if (studies[i]) queue.push(studies[i]!)
  }
  return queue
}

/** Pause after an event when replaying, relative to the per-action pace. */
export function replayDelay(e: GameEvent, paceMs: number): number {
  switch (e.type) {
    case 'decision':
      return paceMs
    case 'street_dealt':
      return paceMs / 2
    case 'hand_ended':
      return paceMs * 2
    case 'game_ended':
      return paceMs * 4
    default:
      return 0
  }
}

/** Plays a replay into the hub at spectator pace; stops early (returning false) when `signal` aborts. */
export async function playReplay(hub: Hub, item: ReplayItem, opts: { paceMs: number; signal?: AbortSignal; sleep?: Sleep }): Promise<boolean> {
  const wait = opts.sleep ?? realSleep
  hub.begin({ mode: 'replay', title: item.title, gameId: item.gameId })
  for (const e of item.events) {
    if (opts.signal?.aborted) return false
    hub.publish(publicEvent(e, true)) // only finished games are replayed
    const ms = replayDelay(e, opts.paceMs)
    if (ms > 0) await wait(ms, opts.signal)
  }
  return !opts.signal?.aborted
}
```

`apps/server/src/index.ts`:
```ts
export * from './config'
export * from './public'
export * from './equity'
export * from './hub'
export * from './sleep'
export * from './replay'
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/server exec vitest run && pnpm --filter @ab/server typecheck`
Expected: PASS (17 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(server): replays of past live games and study highlight reels" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Live controller and director

**Files:**
- Create: `apps/server/src/live.ts`, `apps/server/src/director.ts`
- Modify: `apps/server/src/index.ts`
- Test: `apps/server/test/live.test.ts`, `apps/server/test/director.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/server/test/live.test.ts`:
```ts
import { EventStore, type GameEvent } from '@ab/core'
import { describe, expect, it } from 'vitest'
import { Hub } from '../src/hub'
import { LiveBusyError, LiveController } from '../src/live'
import { mockPlayers } from './fixtures'

function controller(over: Partial<ConstructorParameters<typeof LiveController>[0]> = {}) {
  const store = new EventStore()
  const hub = new Hub()
  const live = new LiveController({ store, hub, makePlayers: mockPlayers, budgetUsd: 10, paceMs: 0, decisionTimeoutMs: 1000, ...over })
  return { store, hub, live }
}

describe('LiveController', () => {
  it('runs one live game at a time on the hub, then goes idle', async () => {
    const { store, hub, live } = controller()
    const changes: string[] = []
    live.onChange((state, id) => changes.push(`${state}:${id}`))
    const { gameId } = await live.start()
    expect(gameId).toMatch(/^live-\d{4}-\d{2}-\d{2}T/)
    expect(live.gameId).toBe(gameId)
    expect(hub.current().channel).toMatchObject({ mode: 'live', gameId })
    await expect(live.start()).rejects.toBeInstanceOf(LiveBusyError)
    await live.idle()
    expect(live.gameId).toBeNull()
    expect(changes).toEqual([`live:${gameId}`, `idle:${gameId}`])
    expect(store.game(gameId)!.status).toBe('ended')
    expect(hub.current().view).toMatchObject({ status: 'ended', gameId })
    expect(hub.current().view.lastSeq).toBe(store.events(gameId).at(-1)!.seq)
  })

  it('deals from a random secret seed, never derived from the public game id', async () => {
    const { store, live } = controller()
    const seeds: string[] = []
    for (let i = 0; i < 2; i++) {
      const { gameId } = await live.start()
      await live.idle()
      const seed = (store.game(gameId)!.config as { tournament: { seed: string } }).tournament.seed
      expect(seed).toMatch(/^[0-9a-f]{32}$/)
      expect(seed).not.toContain(gameId)
      seeds.push(seed)
    }
    expect(seeds[0]).not.toBe(seeds[1])
  })

  it('records the line-up metadata and the per-game budget with the game', async () => {
    const { store, live } = controller({ meta: { lineup: [{ id: 'jev', kind: 'mock' }], mock: true }, budgetUsd: 0.75 })
    const { gameId } = await live.start()
    await live.idle()
    expect(store.game(gameId)!.config).toMatchObject({ lineup: [{ id: 'jev', kind: 'mock' }], mock: true, budgetUsd: 0.75 })
  })

  it('stops after the hand in progress when asked', async () => {
    const { store, live } = controller({ paceMs: 5 })
    expect(live.stop()).toBeNull()
    const { gameId } = await live.start()
    await new Promise((r) => setTimeout(r, 50))
    expect(live.stop()).toBe(gameId)
    await live.idle()
    const last = store.events(gameId).at(-1) as Extract<GameEvent, { type: 'game_ended' }>
    expect(last).toMatchObject({ type: 'game_ended', reason: 'interrupted' })
    expect(store.game(gameId)!.status).toBe('interrupted')
  })

  it('waits (without spinning) while slow players are being prepared', async () => {
    const slow = () => new Promise<ReturnType<typeof mockPlayers>>((resolve) => setTimeout(() => resolve(mockPlayers()), 30))
    const { live } = controller({ makePlayers: slow })
    const started = live.start()
    const idle = live.idle()
    let ticked = false
    await new Promise((r) => setTimeout(r, 10)).then(() => (ticked = true)) // would never fire if idle() spun
    expect(ticked).toBe(true)
    await started
    live.stop()
    await idle
    expect(live.gameId).toBeNull()
  })

  it('frees the table if the players cannot be made', async () => {
    let fail = true
    const { live } = controller({
      makePlayers: () => {
        if (fail) throw new Error('OPENROUTER_API_KEY is not set')
        return mockPlayers()
      },
    })
    await expect(live.start()).rejects.toThrow(/OPENROUTER_API_KEY/)
    expect(live.gameId).toBeNull()
    fail = false
    await live.start()
    await live.idle()
  })
})
```

`apps/server/test/director.test.ts`:
```ts
import { EventStore } from '@ab/core'
import { describe, expect, it } from 'vitest'
import { Director } from '../src/director'
import { Hub, type FeedMessage } from '../src/hub'
import { LiveController } from '../src/live'
import type { ReplayItem } from '../src/replay'
import { mockPlayers, playLiveGame } from './fixtures'

const until = async (check: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

async function setup(queue: () => ReplayItem[], replayPaceMs = 20) {
  const store = new EventStore()
  const hub = new Hub()
  const live = new LiveController({ store, hub, makePlayers: mockPlayers, budgetUsd: 10, paceMs: 1, decisionTimeoutMs: 1000 })
  const director = new Director({ hub, live, queue, replayPaceMs, cooldownMs: 30, emptyWaitMs: 20 })
  const modes: string[] = []
  hub.subscribe((m: FeedMessage) => {
    if (m.type === 'snapshot' && modes.at(-1) !== m.channel.mode) modes.push(m.channel.mode)
  })
  return { store, hub, live, director, modes }
}

describe('Director', () => {
  it('shows replays when idle, cuts to a live game at once, and resumes replays after the cooldown', async () => {
    const events = await playLiveGame(new EventStore(), 'past', 4)
    const { hub, live, director, modes } = await setup(() => [{ title: 'REPLAY · past', gameId: 'past', events }])
    director.start()
    await until(() => hub.current().channel.mode === 'replay' && hub.current().view.handsPlayed >= 1)
    await live.start()
    expect(hub.current().channel.mode).toBe('live')
    await live.idle()
    await until(() => hub.current().channel.mode === 'replay')
    await director.stop()
    expect(modes).toEqual(['idle', 'replay', 'live', 'replay'])
  })

  it('never lets a replay event into a live programme', async () => {
    const events = await playLiveGame(new EventStore(), 'past', 4)
    const { hub, live, director } = await setup(() => [{ title: 'REPLAY · past', gameId: 'past', events }], 5)
    let channel = ''
    const wrong: string[] = []
    hub.subscribe((m) => {
      if (m.type === 'snapshot') channel = m.channel.gameId ?? ''
      if (m.type === 'event' && m.event.gameId !== channel) wrong.push(m.event.gameId)
    })
    director.start()
    await until(() => hub.current().channel.mode === 'replay')
    const { gameId } = await live.start()
    live.stop()
    await live.idle()
    await director.stop()
    expect(gameId).toMatch(/^live-/)
    expect(wrong).toEqual([])
  })

  it('survives a failing replay: logs it, shows the idle screen and tries again', async () => {
    const store = new EventStore()
    const hub = new Hub()
    const live = new LiveController({ store, hub, makePlayers: mockPlayers, budgetUsd: 10, paceMs: 1, decisionTimeoutMs: 1000 })
    const logs: string[] = []
    let calls = 0
    const director = new Director({
      hub, live, replayPaceMs: 5, cooldownMs: 0, emptyWaitMs: 10, log: (l) => logs.push(l),
      queue: () => {
        if (++calls === 1) throw new Error('corrupt log')
        return []
      },
    })
    director.start()
    await until(() => calls >= 3)
    await director.stop()
    expect(logs).toEqual(['director: corrupt log'])
    expect(hub.current().channel.mode).toBe('idle')
  })

  it('shows the idle screen when there is nothing to replay', async () => {
    const { hub, director } = await setup(() => [])
    director.start()
    await new Promise((r) => setTimeout(r, 50))
    expect(hub.current().channel.mode).toBe('idle')
    await director.stop()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ab/server exec vitest run test/live.test.ts test/director.test.ts`
Expected: FAIL (cannot resolve `../src/live`, `../src/director`).

- [ ] **Step 3: Implement**

`apps/server/src/live.ts`:
```ts
import { runTournamentGame, type EventStore } from '@ab/core'
import { liveTurboConfig } from '@ab/engine'
import type { Player } from '@ab/players'
import { randomBytes } from 'node:crypto'
import type { Hub } from './hub'
import { publicEvent } from './public'

export interface LiveDeps {
  store: EventStore
  hub: Hub
  /** Fresh players for each game (players keep no state between games, but models may). */
  makePlayers: () => Player[] | Promise<Player[]>
  budgetUsd: number
  paceMs: number
  decisionTimeoutMs: number
  /** Recorded (and hashed) with each game, e.g. the line-up and whether it is a mock game. */
  meta?: Record<string, unknown>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  log?: (line: string) => void
}

export class LiveBusyError extends Error {
  constructor(readonly gameId: string) {
    super(`a live game is already running (${gameId})`)
  }
}

type Listener = (state: 'live' | 'idle', gameId: string) => void

/** Runs at most one live game at a time and puts its events on the hub. */
export class LiveController {
  private current: { gameId: string; abort: AbortController; done: Promise<void> } | null = null
  private readonly listeners = new Set<Listener>()

  constructor(private readonly deps: LiveDeps) {}

  get gameId(): string | null {
    return this.current?.gameId ?? null
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /**
   * Starts a live game (turbo tournament, per-game budget cap). The deck seed is random and secret:
   * game ids are public, so they must never be the seed. Returns once the game is running.
   */
  async start(): Promise<{ gameId: string }> {
    if (this.current) throw new LiveBusyError(this.current.gameId)
    const now = this.deps.now ?? Date.now
    const gameId = `live-${new Date(now()).toISOString().replace(/[:.]/g, '-')}`
    const abort = new AbortController()
    // Claim the table before any await, so two quick starts can't both run. `done` settles when the
    // table is free again (never resolved early, so idle() waits instead of spinning).
    let finished!: () => void
    const slot = { gameId, abort, done: new Promise<void>((resolve) => (finished = resolve)) }
    this.current = slot
    let players: Player[]
    try {
      players = await this.deps.makePlayers()
    } catch (e) {
      this.current = null
      finished()
      throw e
    }
    this.deps.hub.begin({ mode: 'live', title: 'LIVE', gameId })
    this.emit('live', gameId)
    void runTournamentGame({
      gameId,
      players,
      tournament: liveTurboConfig(randomBytes(16).toString('hex')),
      store: this.deps.store,
      decisionTimeoutMs: this.deps.decisionTimeoutMs,
      paceMs: this.deps.paceMs,
      budgetUsd: this.deps.budgetUsd,
      ...(this.deps.meta ? { meta: this.deps.meta } : {}),
      signal: abort.signal,
      onEvent: (e) => this.deps.hub.publish(publicEvent(e, false)),
      onListenerError: (e) => this.deps.log?.(`feed error: ${String(e)}`),
      ...(this.deps.sleep ? { sleep: this.deps.sleep } : {}),
    })
      .then((t) => this.deps.log?.(`live game ${gameId} ended: ${t.endReason}, winner ${t.winner ?? 'none'}`))
      .catch((e) => this.deps.log?.(`live game ${gameId} failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        this.current = null
        finished()
        this.emit('idle', gameId)
      })
    return { gameId }
  }

  /** Asks the running game to stop after the hand in progress. Returns its id, or null if none. */
  stop(): string | null {
    if (!this.current) return null
    this.current.abort.abort()
    return this.current.gameId
  }

  /** Resolves when no game is running. */
  async idle(): Promise<void> {
    while (this.current) await this.current.done
  }

  private emit(state: 'live' | 'idle', gameId: string): void {
    for (const fn of this.listeners) fn(state, gameId)
  }
}
```

`apps/server/src/director.ts`:
```ts
import type { Hub } from './hub'
import type { LiveController } from './live'
import { playReplay, type ReplayItem } from './replay'
import { sleep as realSleep, type Sleep } from './sleep'

export interface DirectorDeps {
  hub: Hub
  live: LiveController
  /** Replays to show when idle (read fresh each round, so new games join the rotation). */
  queue: () => ReplayItem[]
  replayPaceMs: number
  /** How long a finished live game's result stays up before replays resume. */
  cooldownMs: number
  /** How long to wait before looking again when there is nothing to replay (or after an error). */
  emptyWaitMs?: number
  sleep?: Sleep
  log?: (line: string) => void
}

/**
 * Decides what spectators see: the live game while one runs; otherwise replays in rotation. Starting a
 * live game interrupts the replay at once; after it ends, its result stays up for the cooldown.
 */
export class Director {
  private stopped = new AbortController()
  private interrupt = new AbortController()
  private running: Promise<void> | null = null

  constructor(private readonly deps: DirectorDeps) {
    deps.live.onChange((state) => {
      if (state === 'live') this.interrupt.abort()
    })
  }

  start(): void {
    this.running ??= this.loop()
  }

  /** Stops the rotation (for shutdown); resolves when the loop has exited. */
  async stop(): Promise<void> {
    this.stopped.abort()
    this.interrupt.abort()
    await this.running
  }

  private async loop(): Promise<void> {
    const wait = this.deps.sleep ?? realSleep
    while (!this.stopped.signal.aborted) {
      try {
        await this.round(wait)
      } catch (e) {
        // A bad replay (or a bug) must never take the server down: log it, show the idle screen, retry later.
        this.deps.log?.(`director: ${e instanceof Error ? e.message : String(e)}`)
        if (!this.deps.live.gameId) this.deps.hub.idle()
        await wait(this.deps.emptyWaitMs ?? 60_000, this.stopped.signal)
      }
    }
  }

  /** One step: follow the live game (then the cooldown), or play the replays once, or wait for some. */
  private async round(wait: Sleep): Promise<void> {
    if (this.deps.live.gameId) {
      await this.deps.live.idle()
      if (this.stopped.signal.aborted) return
      await wait(this.deps.cooldownMs, this.stopped.signal)
      return
    }
    this.interrupt = new AbortController()
    const items = this.deps.queue()
    if (items.length === 0) {
      if (!this.deps.live.gameId) this.deps.hub.idle()
      await wait(this.deps.emptyWaitMs ?? 60_000, this.interrupt.signal)
      return
    }
    for (const item of items) {
      if (this.interrupt.signal.aborted || this.stopped.signal.aborted || this.deps.live.gameId) break
      await playReplay(this.deps.hub, item, { paceMs: this.deps.replayPaceMs, signal: this.interrupt.signal, sleep: wait })
    }
  }
}
```

`apps/server/src/index.ts`:
```ts
export * from './config'
export * from './public'
export * from './equity'
export * from './hub'
export * from './sleep'
export * from './replay'
export * from './live'
export * from './director'
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/server exec vitest run && pnpm --filter @ab/server typecheck`
Expected: PASS (27 tests; the live-game tests play whole mock tournaments and take ~15 s); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(server): live controller (one capped game, secret seed) and programme director" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Live line-up

**Files:**
- Create: `apps/server/src/players.ts`
- Modify: `apps/server/src/index.ts`
- Test: `apps/server/test/players.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/server/test/players.test.ts`:
```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mockSpecs, prepareLivePlayers } from '../src/players'

const lineupFile = (players: unknown[]) => {
  const path = join(mkdtempSync(join(tmpdir(), 'ab-lineup-')), 'live.json')
  writeFileSync(path, JSON.stringify({ players }))
  return path
}
const seats = [
  { id: 'jev', kind: 'jev', model: 'jev-1.13.0' },
  { id: 'pill', kind: 'llm', model: 'vendor/model' },
  { id: 'drip', kind: 'bot', bot: 'tag' },
]
const catalog = async () => new Map([['vendor/model', { id: 'vendor/model', supported_parameters: ['structured_outputs', 'temperature'] }]])

describe('live players', () => {
  it('turns paid seats into free mocks', () => {
    expect(mockSpecs(seats as never)).toEqual([
      { id: 'jev', kind: 'mock', model: 'mock/jev-1.13.0' },
      { id: 'pill', kind: 'mock', model: 'mock/vendor/model' },
      { id: 'drip', kind: 'bot', bot: 'tag' },
    ])
  })

  it('mock mode needs no keys and no network', async () => {
    const noNetwork = async () => {
      throw new Error('mock mode must not call the catalog')
    }
    const players = await prepareLivePlayers({ lineupPath: lineupFile(seats), mock: true, env: {} }, noNetwork)
    expect(players.make().map((p) => p.kind)).toEqual(['mock', 'mock', 'bot'])
  })

  it('checks a real line-up at start-up: catalog, request flags and keys', async () => {
    const path = lineupFile(seats)
    await expect(prepareLivePlayers({ lineupPath: path, mock: false, env: {} }, catalog)).rejects.toThrow(/API_KEY is not set/)
    const env = { OPENROUTER_API_KEY: 'k', TYPESAFE_API_KEY: 'k' }
    const ok = await prepareLivePlayers({ lineupPath: path, mock: false, env }, catalog)
    expect(ok.specs[1]).toMatchObject({ structuredOutput: true, sendTemperature: true })
    expect(ok.make()).toHaveLength(3)
    const unknown = lineupFile([seats[0], { id: 'x', kind: 'llm', model: 'nobody/model' }])
    await expect(prepareLivePlayers({ lineupPath: unknown, mock: false, env }, catalog)).rejects.toThrow(/not in the OpenRouter catalog/)
    await expect(prepareLivePlayers({ lineupPath: '/nope.json', mock: false, env }, catalog)).rejects.toThrow(/no line-up at/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/server exec vitest run test/players.test.ts`
Expected: FAIL (cannot resolve `../src/players`).

- [ ] **Step 3: Implement**

`apps/server/src/players.ts`:
```ts
import { adaptLineup, createPlayers, fetchModelCatalog, type CatalogModel, type Player, type PlayerEnv, type PlayerSpec } from '@ab/players'
import { existsSync, readFileSync } from 'node:fs'

export const EXAMPLE_LINEUP = 'lineups/live.example.json'

/** A free line-up: every paid seat (Jev, LLM) becomes a mock player named after its model. */
export function mockSpecs(specs: readonly PlayerSpec[]): PlayerSpec[] {
  return specs.map((s) => (s.kind === 'jev' || s.kind === 'llm' ? { id: s.id, kind: 'mock', model: `mock/${s.model}` } : s))
}

export function readLineup(path: string): PlayerSpec[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { players?: unknown }
  if (!Array.isArray(raw.players) || raw.players.length < 2) throw new Error(`${path}: expected { "players": [ ...at least 2 seats ] }`)
  return raw.players as PlayerSpec[]
}

export interface LivePlayers {
  /** The seats as they will play (request flags adapted, or mocks). */
  specs: PlayerSpec[]
  /** Fresh players for one game. */
  make: () => Player[]
}

/**
 * Prepares the live line-up once at start-up. Mock mode is free and needs no keys (it falls back to the
 * example line-up). A real line-up is checked against the model catalog (a free call) and must have
 * its keys, so problems show up at start-up, not when an admin starts a game.
 */
export async function prepareLivePlayers(
  opts: { lineupPath: string; mock: boolean; env: PlayerEnv },
  catalog: () => Promise<Map<string, CatalogModel>> = () => fetchModelCatalog((url) => fetch(url, { signal: AbortSignal.timeout(15_000) })),
): Promise<LivePlayers> {
  if (opts.mock) {
    const path = existsSync(opts.lineupPath) ? opts.lineupPath : EXAMPLE_LINEUP
    const specs = mockSpecs(readLineup(path))
    createPlayers(specs, {})
    return { specs, make: () => createPlayers(specs, {}) }
  }
  if (!existsSync(opts.lineupPath)) throw new Error(`no line-up at ${opts.lineupPath}: copy ${EXAMPLE_LINEUP} (or run with --mock)`)
  const { specs, problems } = adaptLineup(readLineup(opts.lineupPath), await catalog())
  const unknown = problems.filter((p) => p.includes('not in the OpenRouter catalog'))
  if (unknown.length) throw new Error(`line-up problems: ${unknown.join('; ')}`)
  createPlayers(specs, opts.env) // throws now if a key is missing
  return { specs, make: () => createPlayers(specs, opts.env) }
}
```

`apps/server/src/index.ts`:
```ts
export * from './config'
export * from './public'
export * from './equity'
export * from './hub'
export * from './sleep'
export * from './replay'
export * from './live'
export * from './director'
export * from './players'
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/server exec vitest run && pnpm --filter @ab/server typecheck`
Expected: PASS (30 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(server): live line-up (free mocks, or real players checked at start-up)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: HTTP API, app wiring and `pnpm live`

**Files:**
- Create: `apps/server/src/http.ts`, `apps/server/src/lock.ts`, `apps/server/src/app.ts`, `apps/server/src/main.ts`
- Modify: `apps/server/src/index.ts`, root `package.json` (script), `.env.example`
- Test: `apps/server/test/http.test.ts`, `apps/server/test/lock.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/server/test/http.test.ts`:
```ts
import { EventStore } from '@ab/core'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startApp, type App } from '../src/app'
import { parseServerConfig, type ServerConfig } from '../src/config'
import type { FeedMessage } from '../src/hub'
import { sseWriter } from '../src/http'
import { mockPlayers } from './fixtures'

const TOKEN = 'test-admin-token-0123456789'
const apps: App[] = []

async function app(over: Partial<ServerConfig> = {}): Promise<App> {
  const config: ServerConfig = {
    ...parseServerConfig({}),
    port: 0,
    dbPath: ':memory:',
    adminToken: TOKEN,
    mock: true,
    paceMs: 5,
    decisionTimeoutMs: 1000,
    replayPaceMs: 5,
    cooldownMs: 0,
    ...over,
  }
  const a = await startApp(config, { specs: [], make: mockPlayers }, () => undefined)
  apps.push(a)
  return a
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()))
})

const admin = (a: App, path: string, token = TOKEN) => fetch(`${a.url}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })

/** Reads the SSE feed until `enough` says stop; returns the messages. */
async function readFeed(a: App, enough: (messages: FeedMessage[]) => boolean, ms = 15_000): Promise<FeedMessage[]> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  const res = await fetch(`${a.url}/api/feed`, { signal: ac.signal })
  expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  const messages: FeedMessage[] = []
  let buffer = ''
  try {
    while (!enough(messages)) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let cut: number
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        for (const line of block.split('\n')) if (line.startsWith('data: ')) messages.push(JSON.parse(line.slice(6)) as FeedMessage)
      }
    }
  } finally {
    clearTimeout(timer)
    ac.abort()
  }
  return messages
}

describe('HTTP API', () => {
  it('reports health and state, and answers unknown paths with 404', async () => {
    const a = await app()
    const health = await (await fetch(`${a.url}/api/health`)).json()
    expect(health).toMatchObject({ ok: true, liveGame: null, mock: true })
    const state = await (await fetch(`${a.url}/api/state`)).json()
    expect(state.channel.mode).toBe('idle')
    const missing = await fetch(`${a.url}/api/nope`)
    expect(missing.status).toBe(404)
    expect(missing.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('answers a request target Node accepts but URL rejects with 400, and keeps running', async () => {
    const a = await app()
    const { port } = new URL(a.url)
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = connect(Number(port), '127.0.0.1', () => socket.write('GET //[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'))
      let data = ''
      socket.on('data', (d) => (data += d))
      socket.on('end', () => resolve(data))
      socket.on('error', reject)
    })
    expect(reply).toMatch(/^HTTP\/1\.1 400/)
    expect((await fetch(`${a.url}/api/health`)).status).toBe(200)
  })

  it('disconnects a spectator who falls too far behind', () => {
    let destroyed = false
    const written: string[] = []
    const res = { writableEnded: false, destroyed: false, writableLength: 0, write: (c: string) => written.push(c) > 0, destroy: () => void (destroyed = true) }
    const send = sseWriter(res as never, 1000)
    send({ type: 'equity', channelId: 'c', handId: null, equity: null, estimated: false })
    expect(written).toHaveLength(1)
    res.writableLength = 5000 // the client stopped reading
    expect(() => send({ type: 'equity', channelId: 'c', handId: null, equity: null, estimated: false })).toThrow(/too far behind/)
    expect(destroyed).toBe(true)
  })

  it('serves a finished game in pages', async () => {
    const a = await app()
    const { gameId } = await (await admin(a, '/api/admin/games')).json()
    a.live.stop()
    await a.live.idle()
    const all = a.store.events(gameId)
    const page = await (await fetch(`${a.url}/api/games/${gameId}/events?after=${all.length - 3}`)).json()
    expect(page.events.map((e: { seq: number }) => e.seq)).toEqual(all.slice(-3).map((e) => e.seq))
    expect(page.next).toBeNull()
    expect((await fetch(`${a.url}/api/games/${gameId}/events?after=-1`)).status).toBe(400)
  })

  it('refuses a second server on the same database, and leaves running studies alone', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'ab-app-')), 'live.db')
    const seed = new EventStore(dbPath)
    seed.createGame('crashed-live', 'live', {})
    seed.createGame('study-in-progress', 'study', {})
    seed.close()
    const first = await app({ dbPath })
    expect(first.store.game('crashed-live')!.status).toBe('interrupted')
    expect(first.store.game('study-in-progress')!.status).toBe('running') // another process may be running it
    // A second server process (simulated: another running process holds the lock) is refused.
    writeFileSync(`${dbPath}.server.lock`, String(process.ppid))
    await expect(app({ dbPath })).rejects.toThrow(/another live server/)
    writeFileSync(`${dbPath}.server.lock`, String(process.pid))
  })

  it('guards the admin API: off without a token, 401 with a wrong one', async () => {
    const off = await app({ adminToken: null })
    expect((await admin(off, '/api/admin/games')).status).toBe(403)
    const on = await app()
    expect((await admin(on, '/api/admin/games', 'wrong-token-wrong-token')).status).toBe(401)
    expect((await fetch(`${on.url}/api/admin/games`, { method: 'POST' })).status).toBe(401)
    expect(on.live.gameId).toBeNull()
  })

  it('starts a live game, streams it, refuses a second, stops it, then publishes it', async () => {
    const a = await app()
    const started = await admin(a, '/api/admin/games')
    expect(started.status).toBe(201)
    const { gameId } = await started.json()
    expect((await admin(a, '/api/admin/games')).status).toBe(409)
    // While it runs: the feed shows it, its config and events are withheld.
    const feed = await readFeed(a, (m) => m.filter((x) => x.type === 'event').length >= 20)
    expect(feed[0]).toMatchObject({ type: 'snapshot', channel: { mode: 'live', gameId } })
    expect(feed.filter((m) => m.type === 'event').every((m) => (m as { event: { gameId: string } }).event.gameId === gameId)).toBe(true)
    expect((await (await fetch(`${a.url}/api/games/${gameId}`)).json()).config).toBeNull()
    expect((await fetch(`${a.url}/api/games/${gameId}/events`)).status).toBe(409)
    const list = await (await fetch(`${a.url}/api/games`)).json()
    expect(list.games[0]).toMatchObject({ id: gameId, status: 'running' })
    expect(list.games[0]).not.toHaveProperty('config')
    // Stop it: it ends after the hand in progress, then everything is public.
    const stop = await admin(a, '/api/admin/games/stop')
    expect(stop.status).toBe(202)
    await a.live.idle()
    expect((await admin(a, '/api/admin/games/stop')).status).toBe(409)
    const done = await (await fetch(`${a.url}/api/games/${gameId}/events`)).json()
    expect(done.game).toMatchObject({ id: gameId, status: 'interrupted' })
    expect(done.game.config.tournament.seed).toMatch(/^[0-9a-f]{32}$/)
    expect(done.events.at(-1)).toMatchObject({ type: 'game_ended', reason: 'interrupted' })
  })

  it('allows the configured browser origin only', async () => {
    const a = await app({ allowedOrigin: 'http://localhost:3000' })
    const ok = await fetch(`${a.url}/api/state`, { headers: { Origin: 'http://localhost:3000' } })
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
    const other = await fetch(`${a.url}/api/state`, { headers: { Origin: 'http://evil.example' } })
    expect(other.headers.get('access-control-allow-origin')).toBeNull()
    const preflight = await fetch(`${a.url}/api/admin/games`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000' } })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-headers')).toMatch(/Authorization/)
  })

  it('turns spectators away beyond the limit', async () => {
    const a = await app({ maxClients: 1 })
    const ac = new AbortController()
    const first = await fetch(`${a.url}/api/feed`, { signal: ac.signal })
    expect(first.status).toBe(200)
    const second = await fetch(`${a.url}/api/feed`)
    expect(second.status).toBe(503)
    ac.abort()
  })

  it('on shutdown, ends a running live game as interrupted', async () => {
    const a = await app()
    const { gameId } = await (await admin(a, '/api/admin/games')).json()
    const view = () => a.hub.current().view
    await a.close()
    expect(a.live.gameId).toBeNull()
    expect(view()).toMatchObject({ gameId, status: 'ended', result: { reason: 'interrupted' } })
  })
})
```

`apps/server/test/lock.test.ts`:
```ts
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { acquireServerLock } from '../src/lock'

const db = () => join(mkdtempSync(join(tmpdir(), 'ab-lock-')), 'live.db')

describe('server lock', () => {
  it('lets one server use a database, refuses a second while the first runs, and releases on close', () => {
    const path = db()
    const release = acquireServerLock(path)
    expect(readFileSync(`${path}.server.lock`, 'utf8')).toBe(String(process.pid))
    // Another running process (our parent) holding it: refused.
    writeFileSync(`${path}.server.lock`, String(process.ppid))
    expect(() => acquireServerLock(path)).toThrow(/another live server \(pid \d+\)/)
    writeFileSync(`${path}.server.lock`, String(process.pid))
    release()
    expect(existsSync(`${path}.server.lock`)).toBe(false)
  })

  it('takes over a lock left by a process that is gone, and ignores in-memory databases', () => {
    const path = db()
    writeFileSync(`${path}.server.lock`, '999999')
    const release = acquireServerLock(path)
    expect(readFileSync(`${path}.server.lock`, 'utf8')).toBe(String(process.pid))
    release()
    expect(acquireServerLock(':memory:')).toBeTypeOf('function')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ab/server exec vitest run test/http.test.ts test/lock.test.ts`
Expected: FAIL (cannot resolve `../src/app`, `../src/lock`).

- [ ] **Step 3: Implement**

`apps/server/src/http.ts`:
```ts
import type { EventStore } from '@ab/core'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { ServerConfig } from './config'
import type { FeedMessage, Hub } from './hub'
import { LiveBusyError, type LiveController } from './live'
import { isOver, publicGame } from './public'

export interface HttpDeps {
  config: Pick<ServerConfig, 'adminToken' | 'allowedOrigin' | 'maxClients' | 'mock'>
  /** Unsent bytes a spectator may fall behind by before being disconnected (a paused tab, a stalled network). */
  maxBufferedBytes?: number
  hub: Hub
  store: EventStore
  live: LiveController
  /** Keep-alive comment interval on the feed. */
  heartbeatMs?: number
  log?: (line: string) => void
}

/** Constant-time token check (hashing first makes the lengths equal). */
export function tokenMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/** Most events per page of /api/games/:id/events. */
export const EVENTS_PAGE_LIMIT = 5000

/**
 * A hub subscriber writing to one SSE response. A client that stops reading is disconnected once more
 * than `maxBuffered` bytes are waiting, so one slow spectator can't make the server buffer without limit.
 */
export function sseWriter(res: Pick<ServerResponse, 'write' | 'destroy' | 'writableEnded' | 'destroyed' | 'writableLength'>, maxBuffered: number): (m: FeedMessage) => void {
  return (m) => {
    if (res.writableEnded || res.destroyed) throw new Error('closed')
    if (res.writableLength > maxBuffered) {
      res.destroy()
      throw new Error('spectator too far behind')
    }
    res.write(`data: ${JSON.stringify(m)}\n\n`)
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

/**
 * The spectator and admin API:
 * - GET  /api/health            status and spectator count
 * - GET  /api/state             current channel and table view
 * - GET  /api/feed              Server-Sent Events: a snapshot, then events and equity updates
 * - GET  /api/games             finished and running games (configs withheld while running)
 * - GET  /api/games/:id         one game
 * - GET  /api/games/:id/events  events of a game that is over for good (see isOver), in pages:
 *                                ?after=<seq> (default 0), up to 5,000 per page; `next` is the next ?after
 * - POST /api/admin/games       start a live game (Authorization: Bearer ADMIN_TOKEN)
 * - POST /api/admin/games/stop  stop the live game after the current hand
 */
export function createHttpServer(deps: HttpDeps): Server {
  const heartbeatMs = deps.heartbeatMs ?? 15_000
  const maxBuffered = deps.maxBufferedBytes ?? 1_000_000

  const cors = (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin
    if (deps.config.allowedOrigin && origin === deps.config.allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }
  }

  const admin = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!deps.config.adminToken) {
      send(res, 403, { error: 'admin API disabled: set ADMIN_TOKEN to enable it' })
      return false
    }
    const header = req.headers.authorization ?? ''
    const given = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!given || !tokenMatches(given, deps.config.adminToken)) {
      send(res, 401, { error: 'bad or missing admin token' })
      return false
    }
    return true
  }

  const feed = (req: IncomingMessage, res: ServerResponse) => {
    if (deps.hub.clientCount >= deps.config.maxClients) return send(res, 503, { error: 'too many spectators, try again soon' })
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write('retry: 3000\n\n')
    const unsubscribe = deps.hub.subscribe(sseWriter(res, maxBuffered))
    const heartbeat = setInterval(() => {
      if (res.writableLength > maxBuffered) res.destroy()
      else res.write(': ping\n\n')
    }, heartbeatMs)
    const close = () => {
      clearInterval(heartbeat)
      unsubscribe()
    }
    req.on('close', close)
    res.on('error', close)
  }

  return createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    cors(req, res)
    const method = req.method ?? 'GET'
    let url: URL
    try {
      // Node accepts request targets that URL rejects (e.g. "//["): answer 400, never throw.
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      return send(res, 400, { error: 'bad request' })
    }
    const path = url.pathname.replace(/\/+$/, '') || '/'
    try {
      if (method === 'OPTIONS') {
        if (deps.config.allowedOrigin && req.headers.origin === deps.config.allowedOrigin) {
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST')
          res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
          res.setHeader('Access-Control-Max-Age', '600')
        }
        res.writeHead(204)
        return res.end()
      }
      if (method === 'GET' && path === '/api/health') {
        return send(res, 200, { ok: true, mode: deps.hub.current().channel.mode, liveGame: deps.live.gameId, spectators: deps.hub.clientCount, mock: deps.config.mock })
      }
      if (method === 'GET' && path === '/api/state') return send(res, 200, deps.hub.current())
      if (method === 'GET' && path === '/api/feed') return feed(req, res)
      if (method === 'GET' && path === '/api/games') {
        const games = deps.store
          .games()
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 100)
          .map((g) => {
            const { config: _config, ...rest } = publicGame(g)
            return rest
          })
        return send(res, 200, { games })
      }
      const game = path.match(/^\/api\/games\/([A-Za-z0-9._:-]+)(\/events)?$/)
      if (method === 'GET' && game) {
        const row = deps.store.game(game[1]!)
        if (!row) return send(res, 404, { error: 'no such game' })
        if (!game[2]) return send(res, 200, publicGame(row))
        if (!isOver(row)) return send(res, 409, { error: 'the game is not over yet (running, or a study that can still resume)' })
        const after = Number(url.searchParams.get('after') ?? 0)
        if (!Number.isInteger(after) || after < 0) return send(res, 400, { error: 'after must be a whole number' })
        const events = deps.store.events(row.id, after, EVENTS_PAGE_LIMIT)
        const next = events.length === EVENTS_PAGE_LIMIT ? events.at(-1)!.seq : null
        return send(res, 200, { game: publicGame(row), events, next })
      }
      if (method === 'POST' && path === '/api/admin/games') {
        if (!admin(req, res)) return
        deps.live.start().then(
          ({ gameId }) => send(res, 201, { gameId }),
          (e: unknown) => {
            if (e instanceof LiveBusyError) return send(res, 409, { error: e.message, gameId: e.gameId })
            deps.log?.(`could not start a live game: ${e instanceof Error ? e.message : String(e)}`)
            send(res, 500, { error: 'could not start the game (see the server log)' })
          },
        )
        return
      }
      if (method === 'POST' && path === '/api/admin/games/stop') {
        if (!admin(req, res)) return
        const stopping = deps.live.stop()
        return stopping ? send(res, 202, { stopping, note: 'the game ends after the hand in progress' }) : send(res, 409, { error: 'no live game' })
      }
      return send(res, 404, { error: 'not found' })
    } catch (e) {
      deps.log?.(`request ${method} ${path} failed: ${e instanceof Error ? e.message : String(e)}`)
      if (!res.headersSent) send(res, 500, { error: 'internal error' })
      else res.end()
    }
  })
}
```

`apps/server/src/lock.ts`:
```ts
import { readFileSync, rmSync, writeFileSync } from 'node:fs'

/** Whether a process with this pid is running (on this machine). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Makes sure only one live server uses a database: a second one would mark the first one's running
 * game interrupted (and so publish its seed while it still plays). Writes `<db>.server.lock` with this
 * process id; a lock left by a process that is gone is taken over. Returns the release function.
 */
export function acquireServerLock(dbPath: string, pid = process.pid): () => void {
  if (dbPath === ':memory:') return () => undefined
  const path = `${dbPath}.server.lock`
  try {
    const holder = Number(readFileSync(path, 'utf8').trim())
    if (Number.isInteger(holder) && holder > 0 && holder !== pid && alive(holder)) {
      throw new Error(`another live server (pid ${holder}) is using ${dbPath}; stop it first`)
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  writeFileSync(path, String(pid))
  return () => {
    try {
      if (readFileSync(path, 'utf8').trim() === String(pid)) rmSync(path)
    } catch {
      // already gone
    }
  }
}
```

`apps/server/src/app.ts`:
```ts
import { EventStore } from '@ab/core'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ServerConfig } from './config'
import { Director } from './director'
import { createHttpServer } from './http'
import { Hub } from './hub'
import { LiveController } from './live'
import type { LivePlayers } from './players'
import { acquireServerLock } from './lock'
import { replayQueue, type ReplayCache } from './replay'

export interface App {
  server: Server
  hub: Hub
  live: LiveController
  director: Director
  store: EventStore
  /** Where it is listening. */
  url: string
  /** Stops accepting spectators, stops the live game after its hand, and closes everything. */
  close: () => Promise<void>
}

/** Wires the store, hub, live table, director and HTTP API together and starts listening. */
export async function startApp(config: ServerConfig, players: LivePlayers, log: (line: string) => void = console.log): Promise<App> {
  if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true })
  const release = acquireServerLock(config.dbPath)
  const store = new EventStore(config.dbPath)
  // Only live games: a study in the same database may be running in another process.
  const interrupted = store.interruptRunningGames(Date.now(), 'live')
  if (interrupted.length) log(`marked ${interrupted.length} live game(s) left running by a crash as interrupted: ${interrupted.join(', ')}`)

  const hub = new Hub()
  const live = new LiveController({
    store,
    hub,
    makePlayers: players.make,
    budgetUsd: config.liveBudgetUsd,
    paceMs: config.paceMs,
    decisionTimeoutMs: config.decisionTimeoutMs,
    meta: { lineup: players.specs, mock: config.mock },
    log,
  })
  const replays: ReplayCache = new Map()
  const director = new Director({ hub, live, queue: () => replayQueue(store, {}, replays), replayPaceMs: config.replayPaceMs, cooldownMs: config.cooldownMs, log })
  const server = createHttpServer({ config, hub, store, live, log })
  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve))
  director.start()
  const { port } = server.address() as AddressInfo
  const url = `http://${config.host}:${port}`

  let closing: Promise<void> | null = null
  const close = () =>
    (closing ??= (async () => {
      live.stop()
      await director.stop()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
      await live.idle()
      store.close()
      release()
    })())
  return { server, hub, live, director, store, url, close }
}
```

`apps/server/src/main.ts`:
```ts
/**
 * The live server: one table, replays while idle, spectator feed, admin API.
 *   pnpm live --mock     free: mock players, no keys (the example line-up if lineups/live.json is missing)
 *   pnpm live            real players from LINEUP (default lineups/live.json); live games cost money,
 *                        capped by LIVE_BUDGET_USD per game, and only start when an admin asks.
 * Settings come from the environment (see .env.example).
 */
import { parseServerConfig } from './config'
import { prepareLivePlayers } from './players'
import { startApp } from './app'

try {
  process.loadEnvFile('.env')
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
}

const config = parseServerConfig(process.env, process.argv.slice(2))
const players = await prepareLivePlayers({ lineupPath: config.lineupPath, mock: config.mock, env: process.env })
const app = await startApp(config, players)
console.log(`artificialBluff server on ${app.url} (${config.mock ? 'MOCK: free' : `REAL players, live games capped at $${config.liveBudgetUsd}`})`)
console.log(`players: ${players.specs.map((s) => `${s.id}=${'model' in s ? s.model : s.kind}`).join(', ')}`)
console.log(config.adminToken ? 'admin API on: POST /api/admin/games with Authorization: Bearer $ADMIN_TOKEN' : 'admin API off (set ADMIN_TOKEN to start games)')

let firstSignalAt = 0
const shutdown = (signal: string) => {
  // Ctrl-C reaches this process twice (from the terminal and forwarded by tsx): a repeat within a
  // second is the same keypress, not a request to quit at once.
  if (firstSignalAt) {
    if (Date.now() - firstSignalAt < 1000) return
    console.log('quitting now')
    process.exit(130)
  }
  firstSignalAt = Date.now()
  console.log(`${signal}: stopping after the hand in progress… (again to quit now)`)
  app.close().then(
    () => process.exit(0),
    (e) => {
      console.error(e)
      process.exit(1)
    },
  )
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
```

`apps/server/src/index.ts`:
```ts
export * from './config'
export * from './public'
export * from './equity'
export * from './hub'
export * from './sleep'
export * from './replay'
export * from './live'
export * from './director'
export * from './http'
export * from './players'
export * from './app'
export * from './lock'
```

In the root `package.json` `scripts`, after the `study` script, add:
```json
    "live": "tsx apps/server/src/main.ts"
```

Replace `.env.example` with:
```
# Copy to .env (git-ignored) and fill in. Never commit real keys.
OPENROUTER_API_KEY=
TYPESAFE_API_KEY=

# Live server (pnpm live). Admin API is off unless ADMIN_TOKEN is set (16+ random characters).
ADMIN_TOKEN=
# MOCK=0   (1 = free mock players; same as pnpm live --mock)
# PORT=8787
# HOST=127.0.0.1
# DB_PATH=data/live.db
# LINEUP=lineups/live.json
# LIVE_BUDGET_USD=1
# PACE_MS=2500
# DECISION_TIMEOUT_MS=20000
# REPLAY_PACE_MS=1500
# COOLDOWN_MS=30000
# ALLOWED_ORIGIN=http://localhost:3000
# MAX_CLIENTS=500
```

- [ ] **Step 4: Run everything, then the free server**

Run: `pnpm test && pnpm typecheck`
Expected: PASS (engine 112, players 44, core 39, analysis 20, server 42, study 49); typecheck clean.

Then (free; mock players):
```bash
ADMIN_TOKEN=local-check-token-123456 PORT=8799 DB_PATH=data/live-check.db PACE_MS=50 pnpm live --mock
```
In another terminal:
```bash
curl -s localhost:8799/api/health
curl -s -X POST -H "Authorization: Bearer local-check-token-123456" localhost:8799/api/admin/games
curl -s -N --max-time 2 localhost:8799/api/feed | head -c 600
curl -s -X POST -H "Authorization: Bearer local-check-token-123456" localhost:8799/api/admin/games/stop
```
Expected: health `{"ok":true,"mode":"idle",…,"mock":true}`; start returns `{"gameId":"live-…"}`; the feed starts with `retry: 3000` and a `snapshot` of the running game; stop returns 202. Ctrl-C the server: it prints `SIGINT: stopping after the hand in progress…` and exits. Delete `data/live-check.db*`.

- [ ] **Step 5: Commit**

```bash
git add apps/server package.json .env.example
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(server): HTTP API with SSE feed, admin start/stop, pnpm live" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## After this plan

- `pnpm live --mock` runs the whole spectator backend for free; Plan 4b builds the Broadcast web UI (table, lower third, scoreboard, replays list, research page, about) with the bloub mascots on top of `/api/feed` and `@ab/core`'s `applyEvent`.
- A real live game needs `lineups/live.json`, keys in `.env`, `ADMIN_TOKEN`, and the user's go-ahead.
