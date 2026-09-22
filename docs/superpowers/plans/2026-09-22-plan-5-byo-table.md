# Plan 5: Run Your Own Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/play` page where a visitor seats Jev, any supported OpenRouter model, or free bots, brings their own keys, and watches the tournament run in their own browser on the usual broadcast screen.

**Architecture:**
- The tournament runner, the table view and the win-% code move behind a browser-safe core entry, `@ab/core/browser`, which never imports SQLite or Node.
- `LocalTable` plays the game in the page with an in-memory store and emits the same feed messages as the live server. `/play` reuses `reduceFeed` and `Broadcast`.
- Model seats call OpenRouter straight from the browser: CORS allows it, and "Sign in with OpenRouter" (OAuth PKCE) avoids pasting a key.
- TypeSafe doesn't accept browser calls yet, so Jev seats go through a stateless relay route (`/api/typesafe/v1/systemone`). It forwards the visitor's key per request and never stores or logs it. The page labels it clearly. Remove the relay once TypeSafe allows browser calls.

**Tech Stack:**
- TypeScript strict, pnpm workspaces, Vitest 2 (jsdom for components).
- Next.js 16 (App Router, Turbopack), React 19.
- Existing packages: `@ab/engine`, `@ab/players`, `@ab/core`, `@ab/mascot`.

**Background:**
- Feasibility is in `docs/byo-table-feasibility.md`.
- User decisions (2026-09-22):
  - Users bring their own TypeSafe key (we don't sponsor Jev seats).
  - Any seat's model can be changed.
  - No shared replays and no community page.
  - Ask TypeSafe to enable CORS; the relay is the labelled fallback.

**Conventions (every task):**
- TDD: write the test first and see it fail.
- Commit per task with `git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "..."`, ending the message with the trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Never spend money: every test uses fakes. Never call OpenRouter or TypeSafe with a real key.
- Write the code from this plan; don't copy from any scratch directory.

---

## File map

| File | Responsibility |
| --- | --- |
| `packages/core/src/game-store.ts` | `GameStore` interface: what a tournament needs from a store |
| `packages/core/src/memory-store.ts` | In-memory `GameStore` for browser tables |
| `packages/core/src/equity.ts` | On-screen win % (moved from `apps/server/src/equity.ts`) |
| `packages/core/src/browser.ts` | Browser-safe entry `@ab/core/browser` |
| `apps/web/lib/byo/models.ts` | Supported OpenRouter models, featured list, cost estimate |
| `apps/web/lib/byo/keys.ts` | Key storage (tab or device), Sign in with OpenRouter (PKCE) |
| `apps/web/lib/byo/relay.ts` + `app/api/typesafe/[...path]/route.ts` | TypeSafe relay for Jev seats |
| `apps/web/lib/byo/table.ts` | Setup checks, player building, `LocalTable` game runner |
| `apps/web/components/play/PlaySetup.tsx`, `PlayScreen.tsx`, `app/play/page.tsx` | The /play page |


### Task 1: Browser-safe core (GameStore, MemoryStore, equity, `@ab/core/browser`)

**Files:**
- Create: `packages/core/src/game-store.ts`, `packages/core/src/memory-store.ts`, `packages/core/src/equity.ts`, `packages/core/src/browser.ts`
- Modify: `packages/core/src/game.ts`, `packages/core/src/store.ts`, `packages/core/src/index.ts`, `packages/core/package.json`, `apps/server/src/equity.ts`
- Test: `packages/core/test/browser.test.ts`

- [ ] **Step 1: Write the failing test.** Create `packages/core/test/browser.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { buildView } from '../src/view'
import { liveTurboConfig } from '@ab/engine'
import { CallingStation, MockLlm, TagBot } from '@ab/players'
import { describe, expect, it } from 'vitest'
import { equityKey, MemoryStore, runTournamentGame, tableEquity } from '../src/browser'

/** Files reachable from `entry` through relative imports (type-only imports skipped: they vanish when compiled). */
function reachable(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen
  seen.add(entry)
  const source = readFileSync(entry, 'utf8')
  for (const m of source.matchAll(/^import\s+(type\s+)?[^'"]*from\s+'(\.[^']+)'/gm)) {
    if (m[1]) continue
    reachable(resolve(dirname(entry), `${m[2]}.ts`), seen)
  }
  for (const m of source.matchAll(/^export\s+(type\s+)?[^'"]*from\s+'(\.[^']+)'/gm)) {
    if (m[1]) continue
    reachable(resolve(dirname(entry), `${m[2]}.ts`), seen)
  }
  return seen
}

describe('browser entry (@ab/core/browser)', () => {
  it('never reaches the SQLite store or Node built-ins', () => {
    const files = [...reachable(join(__dirname, '../src/browser.ts'))]
    expect(files.some((f) => f.endsWith('/store.ts'))).toBe(false)
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/from 'node:|from 'better-sqlite3'/)
  })

  it('plays a whole tournament into a MemoryStore', async () => {
    const store = new MemoryStore()
    const seen: number[] = []
    const players = [new MockLlm('jev'), new TagBot('pill'), new MockLlm('block'), new CallingStation('drip'), new MockLlm('nimbus')]
    const t = await runTournamentGame({ gameId: 'g', players, tournament: { ...liveTurboConfig('mem'), maxHands: 30 }, store, decisionTimeoutMs: 1000, budgetUsd: 100, onEvent: (e) => seen.push(e.seq) })
    const events = store.events('g')
    expect(events.map((e) => e.seq)).toEqual(seen)
    expect(events[0]).toMatchObject({ type: 'game_started', configHash: 'in-memory' })
    expect(events.at(-1)).toMatchObject({ type: 'game_ended', handsPlayed: t.handNumber })
    expect(store.status('g')).toBe('ended')
    const cost = events.reduce((c, e) => c + (e.type === 'decision' ? e.costUsd : 0), 0)
    expect(store.gameCost('g')).toBeCloseTo(cost, 12)
    expect(cost).toBeGreaterThan(0) // mock LLMs report a small cost
    expect(() => store.createGame('g', 'live', {})).toThrow(/exists/)
  })

  it('computes on-screen equity (moved from the server)', async () => {
    const store = new MemoryStore()
    const players = [new MockLlm('a'), new CallingStation('b'), new CallingStation('c')]
    await runTournamentGame({ gameId: 'g', players, tournament: { ...liveTurboConfig('eq'), maxHands: 2 }, store, decisionTimeoutMs: 1000, budgetUsd: 100 })
    const events = store.events('g')
    const flop = events.findIndex((e) => e.type === 'street_dealt')
    const view = buildView(events.slice(0, flop + 1))
    const eq = tableEquity(view)!
    expect(eq.estimated).toBe(false)
    expect(Object.values(eq.equity).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    expect(equityKey(view)).toContain(view.hand!.board.join(''))
  })
})
```

- [ ] **Step 2: Run it and see it fail.** Run `pnpm --filter @ab/core exec vitest run test/browser.test.ts`. Expected: FAIL with "Failed to load url ../src/browser".

- [ ] **Step 3: Add the store interface.** Create `packages/core/src/game-store.ts`:

```ts
import type { EventSink, GameKind } from './events'

export type GameStatus = 'running' | 'ended' | 'interrupted'

/**
 * What a tournament game needs from its store. The SQLite EventStore (server, studies) and the
 * MemoryStore (a table running in a browser) both provide it.
 */
export interface GameStore {
  /** Records a new running game; `configHash` is written into its game_started event. */
  createGame(id: string, kind: GameKind, config: unknown): { configHash: string }
  sink(gameId: string): EventSink
  /** Total spent by all players in the game (USD). */
  gameCost(gameId: string): number
  setStatus(id: string, status: GameStatus): void
}
```

- [ ] **Step 4: Add the in-memory store.** Create `packages/core/src/memory-store.ts`:

```ts
import type { EventBody, EventSink, GameEvent, GameKind } from './events'
import type { GameStatus, GameStore } from './game-store'

interface MemoryGame {
  kind: GameKind
  status: GameStatus
  events: GameEvent[]
  cost: number
}

/**
 * A GameStore kept in memory, for a table that runs in the visitor's browser. Nothing is persisted
 * and configs are not hashed (a browser table is not pre-registered research), so its game_started
 * event carries the hash "in-memory".
 */
export class MemoryStore implements GameStore {
  readonly #games = new Map<string, MemoryGame>()

  createGame(id: string, kind: GameKind, _config?: unknown): { configHash: string } {
    if (this.#games.has(id)) throw new Error(`game ${id} exists`)
    this.#games.set(id, { kind, status: 'running', events: [], cost: 0 })
    return { configHash: 'in-memory' }
  }

  sink(gameId: string, now: () => number = Date.now): EventSink {
    const game = this.#game(gameId)
    return {
      append: (body: EventBody) => {
        const event = { ...body, gameId, seq: game.events.length + 1, ts: now() } as GameEvent
        game.events.push(event)
        if (event.type === 'decision') game.cost += event.costUsd
        return event
      },
    }
  }

  gameCost(gameId: string): number {
    return this.#game(gameId).cost
  }

  setStatus(id: string, status: GameStatus): void {
    this.#game(id).status = status
  }

  status(id: string): GameStatus {
    return this.#game(id).status
  }

  events(gameId: string): GameEvent[] {
    return [...this.#game(gameId).events]
  }

  #game(id: string): MemoryGame {
    const game = this.#games.get(id)
    if (!game) throw new Error(`no game ${id}`)
    return game
  }
}
```

- [ ] **Step 5: Move the equity code into core.** Create `packages/core/src/equity.ts`:

```ts
import type { TableView } from './view'
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

Replace the whole of `apps/server/src/equity.ts` with this re-export, so the server's imports keep working:

```ts
export { equityKey, EQUITY_SAMPLES, EXACT_EVALUATION_LIMIT, tableEquity, type TableEquity } from '@ab/core'
```

- [ ] **Step 6: Add the browser entry.** Create `packages/core/src/browser.ts`:

```ts
/**
 * The parts of core that run in a browser (no SQLite, no Node built-ins): the tournament runner, an
 * in-memory store, the table view and on-screen equity. Import as `@ab/core/browser`.
 */
export * from './events'
export * from './game-store'
export * from './memory-store'
export * from './game'
export * from './view'
export * from './equity'
```

- [ ] **Step 7: Point the runner, the SQLite store and the package at the interface.**

In `packages/core/src/game.ts`, replace `import type { EventStore } from './store'` with `import type { GameStore } from './game-store'`. In `TournamentGameOptions`, replace `store: EventStore` with `store: GameStore`.

In `packages/core/src/store.ts`, replace the line `export type GameStatus = 'running' | 'ended' | 'interrupted'` with:

```ts
import type { GameStatus, GameStore } from './game-store'

export type { GameStatus } from './game-store'
```

Put the import next to the other imports at the top of the file. Then change `export class EventStore {` to `export class EventStore implements GameStore {`.

Append to `packages/core/src/index.ts`:

```ts
export * from './game-store'
export * from './memory-store'
export * from './equity'
```

In `packages/core/package.json`, add `"./browser": "./src/browser.ts"` to `exports`, after `"./view"`.

- [ ] **Step 8: Run all the tests.** Run `pnpm test && pnpm typecheck`. Expected: everything passes; core now has 42 tests.
- [ ] **Step 9: Commit.** `git add packages/core apps/server/src/equity.ts && git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(core): browser-safe entry with GameStore, MemoryStore and equity"`


### Task 2: Supported models and cost estimate

**Files:**
- Create: `apps/web/lib/byo/models.ts`
- Modify: `apps/web/package.json`: move `@ab/engine` and `@ab/players` from `devDependencies` to `dependencies`, since the page now uses them at runtime.
- Test: `apps/web/test/byo-models.test.ts`

- [ ] **Step 1: Move the dependencies.** Edit `apps/web/package.json` as described, keeping keys sorted. Then run **`pnpm install` (online, not `--offline`)**. An offline install prunes other platforms' packages from the lockfile, which breaks the Linux Docker build. Expected lockfile diff: 12 lines, the two `link:` entries moving.
- [ ] **Step 2: Write the failing test.** Create `apps/web/test/byo-models.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DECISIONS_PER_SEAT, decisionUsd, estimateGameUsd, FEATURED, jevDecisionUsd, loadCatalog, supportedModels, type CatalogEntry } from '../lib/byo/models'

const entry = (id: string, prompt: string, completion: string, params = ['structured_outputs', 'response_format', 'temperature'], extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id,
  name: id.toUpperCase(),
  pricing: { prompt, completion },
  supported_parameters: params,
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  ...extra,
})

const catalog: CatalogEntry[] = [
  entry('anthropic/claude-sonnet-5', '0.000003', '0.000015'), // featured
  entry('acme/cheap', '0.0000001', '0.0000004'),
  entry('acme/json-only', '0.0000001', '0.0000004', ['response_format']), // no strict structured outputs
  entry('acme/cheap:free', '0', '0'), // free variants are rate-limited: excluded
  entry('acme/cheap:batch', '0.00000005', '0.0000002'), // batch variants are asynchronous: excluded
  entry('~acme/latest', '0.0000001', '0.0000004'), // moving aliases: excluded
  entry('openrouter/auto', '-1', '-1'), // router, priced per call: excluded
  entry('acme/huge', '0.00005', '0.0002'), // over the per-decision ceiling: excluded
  entry('acme/image', '0.0000001', '0.0000004', undefined, { architecture: { input_modalities: ['image'], output_modalities: ['image'] } }),
]

describe('supported OpenRouter models', () => {
  it('keeps text models with strict structured outputs at a sane price, featured first', () => {
    const models = supportedModels(catalog)
    expect(models.map((m) => m.id)).toEqual(['anthropic/claude-sonnet-5', 'acme/cheap'])
    expect(models[0]).toMatchObject({ featured: true, name: 'ANTHROPIC/CLAUDE-SONNET-5' })
    expect(models[1]!.featured).toBe(false)
    expect(models[0]!.decisionUsd).toBeCloseTo(800 * 0.000003 + 80 * 0.000015, 12)
    expect(FEATURED).toContain('meta-llama/llama-4-maverick')
  })

  it('estimates a game: every paid seat up to DECISIONS_PER_SEAT decisions', () => {
    const models = new Map(supportedModels(catalog).map((m) => [m.id, m]))
    const usd = estimateGameUsd([{ kind: 'jev' }, { kind: 'llm', model: 'acme/cheap' }, { kind: 'bot' }], models)
    expect(usd).toBeCloseTo(DECISIONS_PER_SEAT * (jevDecisionUsd() + decisionUsd(catalog[1]!)), 12)
    expect(estimateGameUsd([{ kind: 'llm', model: 'nope/unknown' }], models)).toBe(0)
  })

  it('loads the public catalog', async () => {
    const urls: string[] = []
    const fake = (async (url: string) => {
      urls.push(url)
      return { ok: true, json: async () => ({ data: catalog }) }
    }) as unknown as typeof fetch
    expect(await loadCatalog(fake)).toHaveLength(catalog.length)
    expect(urls).toEqual(['https://openrouter.ai/api/v1/models'])
    const failing = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch
    await expect(loadCatalog(failing)).rejects.toThrow(/503/)
  })
})
```

- [ ] **Step 3: Run it and see it fail** (`pnpm --filter @ab/web exec vitest run test/byo-models.test.ts`: module not found).
- [ ] **Step 4: Implement.** Create `apps/web/lib/byo/models.ts`:

```ts
import { JEV_INPUT_PRICE_PER_MTOK } from '@ab/players'

/** One entry of OpenRouter's public model list (the fields we use). */
export interface CatalogEntry {
  id: string
  name?: string
  pricing: { prompt: string; completion: string }
  supported_parameters?: string[]
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
}

/** A model a seat can use, with its estimated cost per decision. */
export interface ModelOption {
  id: string
  name: string
  decisionUsd: number
  /** In our short list of well-known models (the ones we use ourselves first). */
  featured: boolean
}

export type SeatChoice = { kind: 'jev' } | { kind: 'llm'; model: string } | { kind: 'bot' }

/** Tokens per decision used for estimates: the prompt is about 800 tokens, a reply about 80. */
export const PROMPT_TOKENS = 800
export const REPLY_TOKENS = 80
/** A turbo game rarely needs more decisions than this from one seat (mock games: 60 to 110). */
export const DECISIONS_PER_SEAT = 120
/** Models dearer than this per decision are left out: one game could cost several dollars a seat. */
export const MAX_DECISION_USD = 0.02

/** Well-known models, listed first (our live line-up, then popular cheaper ones). */
export const FEATURED = [
  'anthropic/claude-sonnet-5',
  'openai/gpt-5.6-sol',
  'google/gemini-3.8-flash',
  'meta-llama/llama-4-maverick',
  'anthropic/claude-opus-5',
  'x-ai/grok-4.7',
  'deepseek/deepseek-v4.1-flash',
  'qwen/qwen3.8-flash',
  'mistralai/mistral-small-2603',
  'moonshotai/kimi-k2.6',
]

export const CATALOG_URL = 'https://openrouter.ai/api/v1/models'

/** OpenRouter's public model list (no key needed; the API allows browser calls). */
export async function loadCatalog(fetchImpl: typeof fetch = fetch): Promise<CatalogEntry[]> {
  const res = await fetchImpl(CATALOG_URL)
  if (!res.ok) throw new Error(`model list: HTTP ${res.status}`)
  const body = (await res.json()) as { data?: CatalogEntry[] }
  return body.data ?? []
}

/** Estimated cost of one decision by this model (USD). */
export function decisionUsd(m: CatalogEntry): number {
  return PROMPT_TOKENS * Number(m.pricing.prompt) + REPLY_TOKENS * Number(m.pricing.completion)
}

/** Estimated cost of one Jev decision (input tokens only; output is free). */
export function jevDecisionUsd(): number {
  return (PROMPT_TOKENS * JEV_INPUT_PRICE_PER_MTOK) / 1e6
}

/**
 * The models a seat can use: text in and out, strict structured outputs (our player needs a reply in
 * a fixed JSON shape), a fixed price per token no higher than MAX_DECISION_USD a decision, and not a
 * free (rate-limited), batch (asynchronous) or moving-alias ("~") variant. Featured models first, in
 * FEATURED order, then the rest by name.
 */
export function supportedModels(catalog: CatalogEntry[]): ModelOption[] {
  const options = catalog
    .filter((m) => (m.architecture?.input_modalities ?? []).includes('text') && (m.architecture?.output_modalities ?? []).includes('text'))
    .filter((m) => (m.supported_parameters ?? []).includes('structured_outputs'))
    .filter((m) => !m.id.startsWith('~') && !/:(free|batch)$/.test(m.id))
    .filter((m) => Number(m.pricing.prompt) >= 0 && Number(m.pricing.completion) >= 0 && decisionUsd(m) <= MAX_DECISION_USD)
    .map((m) => ({ id: m.id, name: m.name ?? m.id, decisionUsd: decisionUsd(m), featured: FEATURED.includes(m.id) }))
  const rank = (m: ModelOption) => (m.featured ? FEATURED.indexOf(m.id) : FEATURED.length)
  return options.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

/** Estimated cost of a whole game (USD): each paid seat at DECISIONS_PER_SEAT decisions. Unknown models count 0. */
export function estimateGameUsd(seats: SeatChoice[], models: Map<string, ModelOption>): number {
  return seats.reduce((usd, s) => {
    if (s.kind === 'jev') return usd + DECISIONS_PER_SEAT * jevDecisionUsd()
    if (s.kind === 'llm') return usd + DECISIONS_PER_SEAT * (models.get(s.model)?.decisionUsd ?? 0)
    return usd
  }, 0)
}
```

- [ ] **Step 5: Run it and see it pass** (3 tests), then run `pnpm --filter @ab/web typecheck`.
- [ ] **Step 6: Commit.** `git add apps/web/package.json pnpm-lock.yaml apps/web/lib/byo/models.ts apps/web/test/byo-models.test.ts && git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(web): supported OpenRouter models and cost estimate"`


### Task 3: Keys and Sign in with OpenRouter

**Files:** Create `apps/web/lib/byo/keys.ts`. Test: `apps/web/test/byo-keys.test.ts`.

- [ ] **Step 1: Write the failing test.** Create `apps/web/test/byo-keys.test.ts`:

```ts
// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { authUrl, beginSignIn, challengeFor, exchangeCode, finishSignIn, forgetKeys, loadKeys, newVerifier, saveKeys } from '../lib/byo/keys'

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('keys', () => {
  it('keeps keys for this tab only, unless asked to remember them on this device', () => {
    expect(loadKeys()).toEqual({ openrouter: null, typesafe: null, remember: false })
    saveKeys({ openrouter: 'sk-or-1', typesafe: null, remember: false })
    expect(sessionStorage.length).toBe(1)
    expect(localStorage.length).toBe(0)
    expect(loadKeys()).toEqual({ openrouter: 'sk-or-1', typesafe: null, remember: false })
    saveKeys({ openrouter: 'sk-or-1', typesafe: 'ts-1', remember: true })
    expect(localStorage.length).toBe(1)
    expect(sessionStorage.length).toBe(0)
    expect(loadKeys()).toEqual({ openrouter: 'sk-or-1', typesafe: 'ts-1', remember: true })
    forgetKeys()
    expect(loadKeys()).toEqual({ openrouter: null, typesafe: null, remember: false })
    expect(localStorage.length + sessionStorage.length).toBe(0)
  })
})

describe('Sign in with OpenRouter (OAuth PKCE)', () => {
  it('makes an S256 challenge from a random verifier', async () => {
    const v = newVerifier()
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(newVerifier()).not.toBe(v)
    expect(await challengeFor(v)).toBe(createHash('sha256').update(v).digest('base64url'))
  })

  it('builds the authorisation link', () => {
    const url = new URL(authUrl('https://poker.example.com/play', 'abc'))
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth')
    expect(Object.fromEntries(url.searchParams)).toEqual({ callback_url: 'https://poker.example.com/play', code_challenge: 'abc', code_challenge_method: 'S256' })
  })

  it('exchanges the code for a key, with the verifier kept for this tab', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) })
      return { ok: true, json: async () => ({ key: 'sk-or-new' }) }
    }) as unknown as typeof fetch
    const link = await beginSignIn('https://poker.example.com/play')
    expect(new URL(link).searchParams.get('code_challenge')).toBe(await challengeFor(sessionStorage.getItem('artificialBluff.pkce')!))
    expect(await finishSignIn('the-code', fake)).toBe('sk-or-new')
    expect(calls[0]).toMatchObject({ url: 'https://openrouter.ai/api/v1/auth/keys', body: { code: 'the-code', code_challenge_method: 'S256' } })
    expect(sessionStorage.getItem('artificialBluff.pkce')).toBeNull() // used once
    await expect(finishSignIn('again', fake)).rejects.toThrow(/start/)
    const refused = (async () => ({ ok: false, status: 403 })) as unknown as typeof fetch
    await expect(exchangeCode('c', 'v', refused)).rejects.toThrow(/403/)
  })
})
```

- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.** Create `apps/web/lib/byo/keys.ts`:

```ts
/**
 * The visitor's own API keys. They stay in this browser: in this tab's session storage by default,
 * or in local storage when the visitor asks to be remembered on this device. They are sent only to
 * OpenRouter (directly) and, for a Jev seat, to TypeSafe through our relay (see relay.ts).
 */
export interface Keys {
  openrouter: string | null
  typesafe: string | null
  /** Kept in local storage (survives closing the browser) rather than this tab's session. */
  remember: boolean
}

const KEYS = 'artificialBluff.keys'
const PKCE = 'artificialBluff.pkce'
const NONE: Keys = { openrouter: null, typesafe: null, remember: false }

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null // storage blocked: keys live only in memory for this page
  }
}

export function loadKeys(): Keys {
  for (const kind of ['local', 'session'] as const) {
    try {
      const raw = storage(kind)?.getItem(KEYS)
      if (!raw) continue
      const k = JSON.parse(raw) as Partial<Keys>
      return { openrouter: k.openrouter || null, typesafe: k.typesafe || null, remember: kind === 'local' }
    } catch {
      // unreadable entry: ignore it
    }
  }
  return { ...NONE }
}

export function saveKeys(keys: Keys): void {
  const value = JSON.stringify({ openrouter: keys.openrouter, typesafe: keys.typesafe })
  try {
    storage(keys.remember ? 'session' : 'local')?.removeItem(KEYS)
    storage(keys.remember ? 'local' : 'session')?.setItem(KEYS, value)
  } catch {
    // not persisted
  }
}

export function forgetKeys(): void {
  try {
    storage('local')?.removeItem(KEYS)
    storage('session')?.removeItem(KEYS)
  } catch {
    // nothing stored
  }
}

// ---- Sign in with OpenRouter (OAuth PKCE: https://openrouter.ai/docs/use-cases/oauth-pkce) ----

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A random PKCE code verifier (32 bytes, base64url). */
export function newVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

/** The S256 code challenge for a verifier. */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

export function authUrl(callbackUrl: string, challenge: string): string {
  const url = new URL('https://openrouter.ai/auth')
  url.searchParams.set('callback_url', callbackUrl)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

/** Trades the code OpenRouter sent back for a key the visitor controls. */
export async function exchangeCode(code: string, verifier: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  })
  if (!res.ok) throw new Error(`OpenRouter sign-in failed: HTTP ${res.status}`)
  const body = (await res.json()) as { key?: string }
  if (!body.key) throw new Error('OpenRouter sign-in failed: no key returned')
  return body.key
}

/** Starts a sign-in: keeps a fresh verifier for this tab and returns the link to send the visitor to. */
export async function beginSignIn(callbackUrl: string): Promise<string> {
  const verifier = newVerifier()
  storage('session')?.setItem(PKCE, verifier)
  return authUrl(callbackUrl, await challengeFor(verifier))
}

/** Finishes a sign-in on return (`?code=` in the URL): the verifier is used once. */
export async function finishSignIn(code: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const verifier = storage('session')?.getItem(PKCE)
  if (!verifier) throw new Error('sign-in expired: start it again from this tab')
  storage('session')?.removeItem(PKCE)
  return exchangeCode(code, verifier, fetchImpl)
}
```

- [ ] **Step 4: Run it and see it pass** (4 tests).
- [ ] **Step 5: Commit.** `git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(web): visitor keys and Sign in with OpenRouter (PKCE)"` (add both files first).


### Task 4: TypeSafe relay for Jev seats

**Files:** Create `apps/web/lib/byo/relay.ts` and `apps/web/app/api/typesafe/[...path]/route.ts`. Test: `apps/web/test/byo-relay.test.ts`.

The relay must be stateless and must never log headers or bodies. Behind Caddy, `X-Forwarded-For` and `X-Forwarded-Host` come from Caddy: it overwrites any the client sent, because clients are untrusted proxies. So the rate limit and the origin check can't be spoofed through those headers.

- [ ] **Step 1: Write the failing test.** Create `apps/web/test/byo-relay.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { RateLimiter, RELAY_MAX_BODY, relayTypeSafe, type RelayDeps } from '../lib/byo/relay'

type Seen = { url: string; headers: Record<string, string>; body: string }

function deps(reply: () => Response | Promise<Response> = () => new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json', 'x-typesafe-request-id': 'r1', 'set-cookie': 'a=b' } })) {
  const seen: Seen[] = []
  const d: RelayDeps = {
    upstream: 'https://api.typesafe.test',
    limiter: new RateLimiter(3),
    now: () => 1_000,
    fetch: (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: Object.fromEntries(new Headers(init.headers).entries()), body: String(init.body) })
      return reply()
    }) as unknown as typeof fetch,
  }
  return { d, seen }
}

const request = (headers: Record<string, string> = {}, body = '{"model":"jev-1.13.0"}') =>
  new Request('https://poker.example.com/api/typesafe/v1/systemone', {
    method: 'POST',
    headers: { host: 'poker.example.com', origin: 'https://poker.example.com', authorization: 'Bearer ts-key', 'content-type': 'application/json', cookie: 'session=1', 'x-forwarded-for': '203.0.113.9', ...headers },
    body,
  })

describe('TypeSafe relay', () => {
  it('forwards a Jev call with the visitor key, and only what TypeSafe needs', async () => {
    const { d, seen } = deps()
    const res = await relayTypeSafe(request(), ['v1', 'systemone'], d)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('{"ok":1}')
    expect(res.headers.get('x-typesafe-request-id')).toBe('r1')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(seen).toHaveLength(1)
    expect(seen[0]!.url).toBe('https://api.typesafe.test/v1/systemone')
    expect(seen[0]!.body).toBe('{"model":"jev-1.13.0"}')
    expect(seen[0]!.headers.authorization).toBe('Bearer ts-key')
    expect(seen[0]!.headers.cookie).toBeUndefined() // our cookies never leave
    expect(seen[0]!.headers['x-forwarded-for']).toBeUndefined()
  })

  it('refuses other paths, other sites, missing keys and big bodies', async () => {
    const { d, seen } = deps()
    expect((await relayTypeSafe(request(), ['v1', 'models'], d)).status).toBe(404)
    expect((await relayTypeSafe(request(), ['v1', 'systemone', '..', 'admin'], d)).status).toBe(404)
    expect((await relayTypeSafe(request({ origin: 'https://evil.example' }), ['v1', 'systemone'], d)).status).toBe(403)
    expect((await relayTypeSafe(request({ authorization: '' }), ['v1', 'systemone'], d)).status).toBe(401)
    expect((await relayTypeSafe(request({}, 'x'.repeat(RELAY_MAX_BODY + 1)), ['v1', 'systemone'], d)).status).toBe(413)
    expect(seen).toHaveLength(0)
  })

  it('rate-limits each address', async () => {
    const { d } = deps()
    for (let i = 0; i < 3; i++) expect((await relayTypeSafe(request(), ['v1', 'systemone'], d)).status).toBe(200)
    expect((await relayTypeSafe(request(), ['v1', 'systemone'], d)).status).toBe(429)
    expect((await relayTypeSafe(request({ 'x-forwarded-for': '198.51.100.1' }), ['v1', 'systemone'], d)).status).toBe(200)
    const limiter = new RateLimiter(1)
    expect(limiter.allow('a', 0)).toBe(true)
    expect(limiter.allow('a', 59_999)).toBe(false)
    expect(limiter.allow('a', 60_000)).toBe(true) // a new minute
  })

  it('passes TypeSafe errors through and reports an unreachable TypeSafe as 502', async () => {
    const { d } = deps(() => new Response('{"error":"bad key"}', { status: 401, headers: { 'content-type': 'application/json' } }))
    const res = await relayTypeSafe(request(), ['v1', 'systemone'], d)
    expect(res.status).toBe(401)
    expect(await res.text()).toContain('bad key')
    const { d: down } = deps(() => Promise.reject(new Error('ECONNREFUSED')))
    expect((await relayTypeSafe(request(), ['v1', 'systemone'], down)).status).toBe(502)
  })
})
```

- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement the relay.** Create `apps/web/lib/byo/relay.ts`:

```ts
/**
 * The TypeSafe relay, for Jev seats at tables that run in a visitor's browser. TypeSafe's API does not
 * accept browser (cross-origin) calls yet, so the page calls this route instead and it forwards the
 * request with the visitor's own key. Stateless: the key is forwarded per request and never stored or
 * logged. Only Jev calls are allowed (POST /v1/systemone), from our own pages, small bodies, and a
 * per-address rate limit. Remove once TypeSafe allows browser calls.
 */
export const TYPESAFE_API = 'https://api.typesafe.ai'
export const RELAY_MAX_BODY = 64 * 1024
/** Calls per minute per address: a game makes one Jev call every few seconds. */
export const RELAY_PER_MINUTE = 120
export const RELAY_TIMEOUT_MS = 60_000

/** Paths the relay forwards (joined route segments): only Jev's systemOne calls. */
const ALLOWED = /^v1\/systemone(\/[a-z0-9_-]+)*$/
/** Response headers passed back to the page. */
const PASS_BACK = ['content-type', 'retry-after', 'retry-after-ms', 'x-typesafe-request-id']

/** Fixed one-minute windows per key (the client address); old windows are dropped as they pass. */
export class RateLimiter {
  readonly #windows = new Map<string, { minute: number; count: number }>()
  constructor(readonly perMinute: number) {}

  allow(key: string, now: number): boolean {
    const minute = Math.floor(now / 60_000)
    if (this.#windows.size > 10_000) for (const [k, w] of this.#windows) if (w.minute !== minute) this.#windows.delete(k)
    const w = this.#windows.get(key)
    if (!w || w.minute !== minute) {
      this.#windows.set(key, { minute, count: 1 })
      return true
    }
    w.count++
    return w.count <= this.perMinute
  }
}

export interface RelayDeps {
  fetch: typeof fetch
  limiter: RateLimiter
  now: () => number
  upstream: string
}

export const relayDeps: RelayDeps = { fetch: (...a) => fetch(...a), limiter: new RateLimiter(RELAY_PER_MINUTE), now: Date.now, upstream: TYPESAFE_API }

const json = (status: number, error: string) => Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } })

export async function relayTypeSafe(req: Request, segments: string[], deps: RelayDeps): Promise<Response> {
  const path = segments.join('/')
  if (!ALLOWED.test(path)) return json(404, 'not a Jev call')
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (origin && (!host || new URL(origin).host !== host)) return json(403, 'calls from other sites are not relayed')
  const auth = req.headers.get('authorization') ?? ''
  if (!/^Bearer \S+$/.test(auth)) return json(401, 'a TypeSafe key is needed')
  if (Number(req.headers.get('content-length') ?? 0) > RELAY_MAX_BODY) return json(413, 'request too large')
  const body = await req.text()
  if (body.length > RELAY_MAX_BODY) return json(413, 'request too large')
  const address = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'local'
  if (!deps.limiter.allow(address, deps.now())) return json(429, 'too many Jev calls; slow down')

  let res: Response
  try {
    res = await deps.fetch(`${deps.upstream}/${path}`, {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'artificialBluff-relay' },
      body,
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    })
  } catch {
    return json(502, 'TypeSafe could not be reached')
  }
  const headers = new Headers({ 'cache-control': 'no-store' })
  for (const h of PASS_BACK) {
    const v = res.headers.get(h)
    if (v) headers.set(h, v)
  }
  return new Response(await res.arrayBuffer(), { status: res.status, headers })
}
```

- [ ] **Step 4: Add the route.** Create `apps/web/app/api/typesafe/[...path]/route.ts`:

```ts
import { relayDeps, relayTypeSafe } from '../../../../lib/byo/relay'

/** POST /api/typesafe/v1/systemone: Jev calls from tables in visitors' browsers (see lib/byo/relay.ts). */
export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  return relayTypeSafe(req, path, relayDeps)
}
```

- [ ] **Step 5: Run it and see it pass** (4 tests), then run `pnpm --filter @ab/web typecheck`.
- [ ] **Step 6: Commit.** `git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(web): stateless TypeSafe relay for Jev seats"`


### Task 5: LocalTable, a tournament in the browser

**Files:** Create `apps/web/lib/byo/table.ts`. Test: `apps/web/test/byo-table.test.ts`.

The fake network in the test answers OpenRouter with a fold and fails TypeSafe (503), so Jev falls back to check-or-fold. That proves each key goes only to its own service without needing TypeSafe's reply format.

- [ ] **Step 1: Write the failing test.** Create `apps/web/test/byo-table.test.ts`:

```ts
import type { CatalogModel } from '@ab/players'
import type { FeedMessage } from '@ab/server'
import { describe, expect, it } from 'vitest'
import { initialFeed, reduceFeed } from '../lib/feed'
import type { ModelOption, SeatChoice } from '../lib/byo/models'
import { checkSetup, DEFAULT_SEATS, LocalTable, seatId, type TableSetup } from '../lib/byo/table'

type Call = { url: string; auth: string | null; referer: string | null }

/** OpenRouter answers every call (a fold, costing `cost`); TypeSafe fails, so Jev falls back to check-or-fold. */
function fakeNetwork(cost = 0.001) {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers)
    calls.push({ url, auth: headers.get('authorization'), referer: headers.get('http-referer') })
    if (url.startsWith('https://openrouter.ai/')) {
      const content = JSON.stringify({ action: 'fold', win_probability: 0.3, confidence: 0.5, reasoning: 'folding' })
      return Response.json({ model: 'acme/m', choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 800, completion_tokens: 20, cost } })
    }
    return new Response('{"error":"unavailable"}', { status: 503, headers: { 'content-type': 'application/json' } })
  }) as typeof globalThis.fetch
  return { calls, fetch }
}

const catalog = new Map<string, CatalogModel>([['acme/m', { id: 'acme/m', supported_parameters: ['structured_outputs', 'temperature'] }]])
const models = new Map<string, ModelOption>([['acme/m', { id: 'acme/m', name: 'Acme M', decisionUsd: 0.001, featured: false }]])
const seats: SeatChoice[] = [{ kind: 'jev' }, { kind: 'llm', model: 'acme/m' }, { kind: 'bot' }, { kind: 'bot' }, { kind: 'bot' }]
const setup = (over: Partial<TableSetup> = {}): TableSetup => ({ seats, openrouterKey: 'or-key', typesafeKey: 'ts-key', budgetUsd: 5, ...over })
const deps = (fetch: typeof globalThis.fetch) => ({ catalog, relayBase: 'https://site.test/api/typesafe', referer: 'https://site.test', fetch, seed: 'fixed', paceMs: 0 })

describe('a table in the browser', () => {
  it('says what is missing before it can start', () => {
    expect(checkSetup(setup(), models)).toEqual([])
    expect(checkSetup(setup({ openrouterKey: null, typesafeKey: null, budgetUsd: 50 }), models)).toEqual([
      'connect OpenRouter (or paste a key) for the model seats',
      'add a TypeSafe key for the Jev seat',
      'the spending cap must be between $0.1 and $20',
    ])
    expect(checkSetup(setup({ seats: [{ kind: 'bot' }, { kind: 'jev' }, { kind: 'llm', model: 'nope/x' }, { kind: 'bot' }, { kind: 'bot' }] }), models)).toEqual([
      'Jev can only play the first seat',
      'seat 3: choose a model from the list',
    ])
    expect(checkSetup(setup({ seats: [{ kind: 'bot' }, { kind: 'bot' }, { kind: 'bot' }, { kind: 'bot' }, { kind: 'bot' }], openrouterKey: null, typesafeKey: null }), models)).toEqual([]) // a free all-bot table
    expect(DEFAULT_SEATS[0]).toEqual({ kind: 'jev' })
    expect([seatId({ kind: 'jev' }, 0), seatId({ kind: 'bot' }, 0), seatId({ kind: 'bot' }, 3)]).toEqual(['jev', 'pebble', 'drip'])
  })

  it('plays a whole game: models straight to OpenRouter, Jev through our relay, the feed a spectator screen understands', async () => {
    const net = fakeNetwork()
    const messages: FeedMessage[] = []
    const table = new LocalTable(setup(), deps(net.fetch), (m) => messages.push(m))
    expect(await table.start()).toBe('ended')

    const toOpenRouter = net.calls.filter((c) => c.url === 'https://openrouter.ai/api/v1/chat/completions')
    const toRelay = net.calls.filter((c) => c.url === 'https://site.test/api/typesafe/v1/systemone')
    expect(toOpenRouter.length).toBeGreaterThan(0)
    expect(toRelay.length).toBeGreaterThan(0)
    expect(toOpenRouter.length + toRelay.length).toBe(net.calls.length) // nothing else is called
    expect(toOpenRouter.every((c) => c.auth === 'Bearer or-key' && c.referer === 'https://site.test')).toBe(true)
    expect(toRelay.every((c) => c.auth === 'Bearer ts-key')).toBe(true) // each key goes only to its own service
    expect(table.spentUsd()).toBeCloseTo(toOpenRouter.length * 0.001, 9)

    expect(messages[0]).toMatchObject({ type: 'snapshot', channel: { mode: 'live', gameId: table.gameId } })
    expect(messages.some((m) => m.type === 'equity')).toBe(true)
    let state = initialFeed()
    for (const m of messages) state = reduceFeed(state, m, (id) => id.toUpperCase())
    expect(state.view.status).toBe('ended')
    expect(state.view.seats.map((s) => s.playerId)).toEqual(['jev', 'pill', 'block', 'drip', 'nimbus'])
  })

  it('ends at the spending cap', async () => {
    const net = fakeNetwork(0.05)
    const messages: FeedMessage[] = []
    const table = new LocalTable(setup({ budgetUsd: 0.1 }), deps(net.fetch), (m) => messages.push(m))
    await table.start()
    const end = [...messages].reverse().find((m) => m.type === 'event' && m.event.type === 'game_ended')
    expect(end).toMatchObject({ event: { reason: 'budget_cap' } })
    expect(table.spentUsd()).toBeLessThan(0.1 + 0.05 * 2)
  })

  it('stops after the hand in progress', async () => {
    const net = fakeNetwork()
    const messages: FeedMessage[] = []
    const table = new LocalTable(setup(), deps(net.fetch), (m) => messages.push(m))
    const done = table.start()
    table.stop()
    expect(await done).toBe('interrupted')
    const hands = messages.filter((m) => m.type === 'event' && m.event.type === 'hand_started').length
    expect(hands).toBe(1)
  })
})
```

- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.** Create `apps/web/lib/byo/table.ts`:

```ts
import { applyEvent, emptyView, equityKey, MemoryStore, runTournamentGame, tableEquity, withEquity, type GameEvent } from '@ab/core/browser'
import { liveTurboConfig } from '@ab/engine'
import { adaptLineup, JevPlayer, LlmPlayer, TagBot, type CatalogModel, type Player, type PlayerSpec } from '@ab/players'
import type { Channel, FeedMessage } from '@ab/server'
import type { ModelOption, SeatChoice } from './models'

/** Seat ids (the on-screen characters). Seat 0 is JEV when Jev plays it, PEBBLE otherwise. */
export const SEAT_IDS = ['jev', 'pill', 'block', 'drip', 'nimbus'] as const
export const JEV_MODEL = 'jev-1.13.0'
export const DEFAULT_SEATS: SeatChoice[] = [
  { kind: 'jev' },
  { kind: 'llm', model: 'anthropic/claude-sonnet-5' },
  { kind: 'llm', model: 'openai/gpt-5.6-sol' },
  { kind: 'llm', model: 'google/gemini-3.8-flash' },
  { kind: 'llm', model: 'meta-llama/llama-4-maverick' },
]
export const MIN_BUDGET_USD = 0.1
export const MAX_BUDGET_USD = 20
export const DECISION_TIMEOUT_MS = 20_000
/** Pause after each event, so viewers can follow bots and fast models. */
export const TABLE_PACE_MS = 900

export const seatId = (seat: SeatChoice, index: number): string => (index === 0 && seat.kind !== 'jev' ? 'pebble' : SEAT_IDS[index]!)

export interface TableSetup {
  seats: SeatChoice[]
  openrouterKey: string | null
  typesafeKey: string | null
  budgetUsd: number
}

export interface TableDeps {
  /** OpenRouter's catalog entries by id (for each model's request settings). */
  catalog: Map<string, CatalogModel>
  /** Base URL of our TypeSafe relay, e.g. `${location.origin}/api/typesafe`. */
  relayBase: string
  /** This site, sent to OpenRouter as the app's referer. */
  referer: string
  fetch?: typeof fetch
  seed?: string
  paceMs?: number
  sleep?: (ms: number) => Promise<void>
}

/** What stops a table from starting, in plain words (empty when it can start). */
export function checkSetup(setup: TableSetup, models: Map<string, ModelOption>): string[] {
  const problems: string[] = []
  if (setup.seats.length !== SEAT_IDS.length) problems.push(`a table has ${SEAT_IDS.length} seats`)
  setup.seats.forEach((s, i) => {
    if (s.kind === 'jev' && i !== 0) problems.push('Jev can only play the first seat')
    if (s.kind === 'llm' && !models.has(s.model)) problems.push(`seat ${i + 1}: choose a model from the list`)
  })
  if (setup.seats.some((s) => s.kind === 'llm') && !setup.openrouterKey) problems.push('connect OpenRouter (or paste a key) for the model seats')
  if (setup.seats.some((s) => s.kind === 'jev') && !setup.typesafeKey) problems.push('add a TypeSafe key for the Jev seat')
  if (!(setup.budgetUsd >= MIN_BUDGET_USD && setup.budgetUsd <= MAX_BUDGET_USD)) problems.push(`the spending cap must be between $${MIN_BUDGET_USD} and $${MAX_BUDGET_USD}`)
  return problems
}

/** The players for a checked setup: Jev through our relay, models straight to OpenRouter, bots free. */
export function buildPlayers(setup: TableSetup, deps: TableDeps): Player[] {
  const specs: PlayerSpec[] = setup.seats.map((s, i): PlayerSpec => {
    const id = seatId(s, i)
    if (s.kind === 'jev') return { id, kind: 'jev', model: JEV_MODEL }
    if (s.kind === 'llm') return { id, kind: 'llm', model: s.model }
    return { id, kind: 'bot', bot: 'tag' }
  })
  const { specs: adapted } = adaptLineup(specs, deps.catalog)
  const fetchOpt = deps.fetch ? { fetch: deps.fetch } : {}
  return adapted.map((spec): Player => {
    if (spec.kind === 'jev') {
      return new JevPlayer({ id: spec.id, model: spec.model, client: { apiKey: setup.typesafeKey!, baseURL: deps.relayBase, dangerouslyAllowBrowser: true, ...fetchOpt } })
    }
    if (spec.kind === 'llm') {
      return new LlmPlayer({
        id: spec.id,
        model: spec.model,
        openrouter: { apiKey: setup.openrouterKey!, referer: deps.referer, title: 'artificialBluff', ...fetchOpt },
        ...(spec.reasoning !== undefined ? { reasoning: spec.reasoning } : {}),
        ...(spec.structuredOutput !== undefined ? { structuredOutput: spec.structuredOutput } : {}),
        ...(spec.sendTemperature !== undefined ? { sendTemperature: spec.sendTemperature } : {}),
      })
    }
    return new TagBot(spec.id)
  })
}

const randomSeed = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')

/**
 * A turbo tournament played in this browser. It sends the same messages as the live server's feed (a
 * snapshot, then events and equity), so the page shows it with the usual broadcast screen. Stopping
 * lets the hand in progress finish; the spending cap ends the game once reached.
 */
export class LocalTable {
  readonly gameId = `table-${Date.now()}`
  readonly channel: Channel = { id: `local-${this.gameId}`, mode: 'live', title: 'Your table', gameId: this.gameId }
  readonly #store = new MemoryStore()
  readonly #abort = new AbortController()
  #view = emptyView()
  #equityKey: string | null = null

  constructor(
    readonly setup: TableSetup,
    readonly deps: TableDeps,
    readonly onMessage: (m: FeedMessage) => void,
  ) {}

  /** Plays the game to its end; resolves with how it ended. */
  async start(): Promise<'ended' | 'interrupted'> {
    this.onMessage({ type: 'snapshot', channel: this.channel, view: this.#view })
    await runTournamentGame({
      gameId: this.gameId,
      players: buildPlayers(this.setup, this.deps),
      tournament: liveTurboConfig(this.deps.seed ?? randomSeed()),
      store: this.#store,
      decisionTimeoutMs: DECISION_TIMEOUT_MS,
      paceMs: this.deps.paceMs ?? TABLE_PACE_MS,
      budgetUsd: this.setup.budgetUsd,
      signal: this.#abort.signal,
      meta: { source: 'browser-table' },
      onEvent: (e) => this.#publish(e),
      ...(this.deps.sleep ? { sleep: this.deps.sleep } : {}),
    })
    return this.#store.status(this.gameId) === 'ended' ? 'ended' : 'interrupted'
  }

  /** Ends the game after the hand in progress. */
  stop(): void {
    this.#abort.abort()
  }

  /** Spent so far by all seats (USD). */
  spentUsd(): number {
    return this.#store.gameCost(this.gameId)
  }

  // Same as the live server's hub: equity is recomputed when the board or the players still in change.
  #publish(event: GameEvent): void {
    this.#view = applyEvent(this.#view, event)
    this.onMessage({ type: 'event', channelId: this.channel.id, event })
    const key = equityKey(this.#view)
    if (key === this.#equityKey) return
    this.#equityKey = key
    if (key === null) return
    const result = tableEquity(this.#view)
    this.#view = withEquity(this.#view, result?.equity ?? null, result?.estimated ?? false)
    this.onMessage({ type: 'equity', channelId: this.channel.id, handId: this.#view.hand?.handId ?? null, equity: this.#view.equity, estimated: this.#view.equityEstimated })
  }
}
```

- [ ] **Step 4: Run it and see it pass** (4 tests, about 3 s), then run `pnpm --filter @ab/web typecheck`.
- [ ] **Step 5: Commit.** `git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(web): LocalTable plays a tournament in the browser"`


### Task 6: The /play page

**Files:**
- Create: `apps/web/components/play/PlaySetup.tsx`, `apps/web/components/play/PlayScreen.tsx`, `apps/web/app/play/page.tsx`
- Modify: `apps/web/app/layout.tsx` (a "Play" link after "Table"), `apps/web/app/globals.css`
- Test: `apps/web/test/play.test.tsx`

- [ ] **Step 1: Write the failing test.** Create `apps/web/test/play.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayScreen } from '../components/play/PlayScreen'
import type { CatalogEntry } from '../lib/byo/models'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const model = (id: string): CatalogEntry => ({
  id,
  name: id,
  pricing: { prompt: '0.000001', completion: '0.000002' },
  supported_parameters: ['structured_outputs'],
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
})
const catalog = ['anthropic/claude-sonnet-5', 'openai/gpt-5.6-sol', 'google/gemini-3.8-flash', 'meta-llama/llama-4-maverick', 'acme/other'].map(model)

let root: Root
let host: HTMLDivElement
const settle = () => act(async () => await new Promise((r) => setTimeout(r, 0)))
const text = () => host.textContent ?? ''
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement | undefined
function choose(label: string, value: string) {
  const el = host.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement | HTMLInputElement
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

beforeEach(async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url) === 'https://openrouter.ai/api/v1/models') return { ok: true, json: async () => ({ data: catalog }) }
    throw new Error(`unexpected call to ${url}`)
  })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<PlayScreen paceMs={0} />))
  await settle()
})
afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

describe('/play', () => {
  it('starts with Jev and four models, and says what is missing', () => {
    expect(text()).toContain('JEV')
    expect((host.querySelector('[aria-label="seat 2 model"]') as HTMLInputElement).value).toBe('anthropic/claude-sonnet-5')
    expect(text()).toContain('connect OpenRouter (or paste a key) for the model seats')
    expect(text()).toContain('add a TypeSafe key for the Jev seat')
    expect(text()).toContain('Relayed:') // the Jev relay is explained next to the TypeSafe key
    expect(button('Start the game')!.disabled).toBe(true)
    choose('OpenRouter key', 'sk-or-test')
    choose('TypeSafe key', 'ts-test')
    expect(button('Start the game')!.disabled).toBe(false)
    expect(host.querySelectorAll('#play-models option')).toHaveLength(5)
  })

  it('runs a free all-bot table on the broadcast screen, keeping no keys', async () => {
    for (let i = 1; i <= 5; i++) choose(`seat ${i} player`, 'bot')
    expect(text()).toContain('PEBBLE') // seat 1 without Jev
    expect(text()).not.toContain('Relayed:')
    expect(text()).toContain('≈ $0 for a whole game')
    await act(async () => button('Start the game')!.click())
    for (let i = 0; i < 50 && !button('New table'); i++) await settle()
    expect(host.querySelector('.broadcast')).not.toBeNull()
    expect(host.querySelectorAll('.log li').length).toBeGreaterThan(0)
    expect(button('New table')).toBeDefined()
    expect(text()).toContain('spent $0 of $1')
    expect(localStorage.length).toBe(0)
    act(() => button('New table')!.click())
    expect(text()).toContain('Run your own table')
  })
})
```

- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Add the setup form.** Create `apps/web/components/play/PlaySetup.tsx`:

```tsx
'use client'
import { characterFor } from '@ab/mascot'
import { usd } from '../../lib/format'
import { DECISIONS_PER_SEAT, estimateGameUsd, type ModelOption, type SeatChoice } from '../../lib/byo/models'
import { MAX_BUDGET_USD, MIN_BUDGET_USD, seatId } from '../../lib/byo/table'

export interface SetupState {
  seats: SeatChoice[]
  openrouterKey: string
  typesafeKey: string
  remember: boolean
  budgetUsd: number
}

/** The form for a table: who sits where, the visitor's keys, the spending cap and the cost estimate. */
export function PlaySetup(props: {
  value: SetupState
  onChange: (next: SetupState) => void
  models: ModelOption[] | null
  modelsError: string | null
  problems: string[]
  onSignIn: () => void
  onStart: () => void
}) {
  const { value: v, onChange } = props
  const byId = new Map((props.models ?? []).map((m) => [m.id, m]))
  const setSeat = (i: number, seat: SeatChoice) => onChange({ ...v, seats: v.seats.map((s, j) => (j === i ? seat : s)) })
  const needsJev = v.seats.some((s) => s.kind === 'jev')
  const needsOpenRouter = v.seats.some((s) => s.kind === 'llm')
  const estimate = estimateGameUsd(v.seats, byId)

  return (
    <form
      className="play-setup"
      onSubmit={(e) => {
        e.preventDefault()
        props.onStart()
      }}
    >
      <h1>Run your own table</h1>
      <p className="lede">
        Seat any models you like and watch them play a turbo tournament. The game runs in this browser with your own keys; you pay the providers directly.
      </p>

      <fieldset>
        <legend>Players</legend>
        {v.seats.map((s, i) => (
          <div className="seat-choice" key={i}>
            <b>{characterFor(seatId(s, i), i).name}</b>
            <select
              aria-label={`seat ${i + 1} player`}
              value={s.kind}
              onChange={(e) => {
                const kind = e.target.value as SeatChoice['kind']
                setSeat(i, kind === 'llm' ? { kind, model: props.models?.[0]?.id ?? '' } : { kind })
              }}
            >
              {i === 0 ? <option value="jev">Jev (TypeSafe)</option> : null}
              <option value="llm">A model (OpenRouter)</option>
              <option value="bot">Free bot</option>
            </select>
            {s.kind === 'llm' ? (
              <>
                <input
                  aria-label={`seat ${i + 1} model`}
                  list="play-models"
                  value={s.model}
                  placeholder="search models…"
                  onChange={(e) => setSeat(i, { kind: 'llm', model: e.target.value.trim() })}
                />
                <small>{byId.get(s.model) ? `≈ ${usd(byId.get(s.model)!.decisionUsd)} a decision` : 'pick from the list'}</small>
              </>
            ) : null}
          </div>
        ))}
        <datalist id="play-models">
          {(props.models ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {`${m.featured ? '★ ' : ''}${m.name} · ${usd(m.decisionUsd)}/decision`}
            </option>
          ))}
        </datalist>
        {props.modelsError ? <p className="warn">Couldn't load OpenRouter's model list: {props.modelsError}</p> : null}
        {props.models === null && !props.modelsError ? <p className="muted">Loading OpenRouter's models…</p> : null}
      </fieldset>

      {needsOpenRouter ? (
        <fieldset>
          <legend>OpenRouter (the model seats)</legend>
          <button type="button" onClick={props.onSignIn}>
            Sign in with OpenRouter
          </button>{' '}
          <span className="muted">or paste a key:</span>{' '}
          <input aria-label="OpenRouter key" type="password" autoComplete="off" placeholder="sk-or-…" value={v.openrouterKey} onChange={(e) => onChange({ ...v, openrouterKey: e.target.value.trim() })} />
          {v.openrouterKey ? <span className="ok"> ✓ connected</span> : null}
        </fieldset>
      ) : null}

      {needsJev ? (
        <fieldset>
          <legend>TypeSafe (the Jev seat)</legend>
          <input aria-label="TypeSafe key" type="password" autoComplete="off" placeholder="TypeSafe API key" value={v.typesafeKey} onChange={(e) => onChange({ ...v, typesafeKey: e.target.value.trim() })} />
          <p className="notice">
            Relayed: TypeSafe doesn't accept calls from web pages yet, so Jev's requests pass through our server, which forwards your key to TypeSafe with each
            call and never stores or logs it. Model seats talk to OpenRouter directly.
          </p>
        </fieldset>
      ) : null}

      <fieldset>
        <legend>Spending</legend>
        <label>
          Stop the game at ${' '}
          <input
            aria-label="spending cap"
            type="number"
            min={MIN_BUDGET_USD}
            max={MAX_BUDGET_USD}
            step="0.1"
            value={v.budgetUsd}
            onChange={(e) => onChange({ ...v, budgetUsd: Number(e.target.value) })}
          />
        </label>
        <p className="estimate">
          Estimated cost ≈ <b>{usd(estimate)}</b> for a whole game (up to {DECISIONS_PER_SEAT} decisions a seat). It never goes past your cap.
        </p>
        <label className="remember">
          <input type="checkbox" checked={v.remember} onChange={(e) => onChange({ ...v, remember: e.target.checked })} /> Remember my keys on this device
        </label>
      </fieldset>

      {props.problems.length ? (
        <ul className="problems">
          {props.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      <button type="submit" className="start" disabled={props.problems.length > 0}>
        Start the game
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Add the screen.** Tables start only from the Start button's click handler, never from an effect: StrictMode runs effects twice in development, which would start two paid games. Create `apps/web/components/play/PlayScreen.tsx`:

```tsx
'use client'
import { characterFor } from '@ab/mascot'
import type { FeedMessage } from '@ab/server'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { usd } from '../../lib/format'
import { initialFeed, reduceFeed, type FeedState } from '../../lib/feed'
import { beginSignIn, finishSignIn, forgetKeys, loadKeys, saveKeys } from '../../lib/byo/keys'
import { loadCatalog, supportedModels, type CatalogEntry, type ModelOption } from '../../lib/byo/models'
import { checkSetup, DEFAULT_SEATS, LocalTable, TABLE_PACE_MS } from '../../lib/byo/table'
import { Broadcast } from '../Broadcast'
import { PlaySetup, type SetupState } from './PlaySetup'

const name = (id: string) => characterFor(id).name

/** /play: set up a table with your own keys, then watch it on the broadcast screen. */
export function PlayScreen({ paceMs = TABLE_PACE_MS }: { paceMs?: number }) {
  const [setup, setSetup] = useState<SetupState>({ seats: DEFAULT_SEATS, openrouterKey: '', typesafeKey: '', remember: false, budgetUsd: 1 })
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [feed, dispatch] = useReducer((s: FeedState, m: FeedMessage) => reduceFeed(s, m, name), undefined, initialFeed)
  const [phase, setPhase] = useState<'setup' | 'playing' | 'over'>('setup')
  const [spent, setSpent] = useState(0)
  const table = useRef<LocalTable | null>(null)

  // Keys kept from before, and a sign-in coming back from OpenRouter (?code=…).
  useEffect(() => {
    const keys = loadKeys()
    setSetup((s) => ({ ...s, openrouterKey: keys.openrouter ?? '', typesafeKey: keys.typesafe ?? '', remember: keys.remember }))
    const code = new URLSearchParams(window.location.search).get('code')
    if (!code) return
    window.history.replaceState(null, '', window.location.pathname)
    finishSignIn(code).then(
      (key) => setSetup((s) => ({ ...s, openrouterKey: key })),
      (e: unknown) => setSignInError((e as Error).message),
    )
  }, [])

  useEffect(() => {
    loadCatalog().then(setCatalog, (e: unknown) => setCatalogError((e as Error).message))
  }, [])

  // Leaving the page ends the game (it runs here): ask first, and stop it when the page goes away.
  useEffect(() => {
    if (phase !== 'playing') return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    const tick = setInterval(() => setSpent(table.current?.spentUsd() ?? 0), 1000)
    return () => {
      window.removeEventListener('beforeunload', warn)
      clearInterval(tick)
    }
  }, [phase])
  useEffect(() => () => table.current?.stop(), [])

  const models: ModelOption[] | null = useMemo(() => (catalog ? supportedModels(catalog) : null), [catalog])
  const modelMap = useMemo(() => new Map((models ?? []).map((m) => [m.id, m])), [models])
  const tableSetup = { seats: setup.seats, openrouterKey: setup.openrouterKey || null, typesafeKey: setup.typesafeKey || null, budgetUsd: setup.budgetUsd }
  const problems = catalog ? checkSetup(tableSetup, modelMap) : ['loading the model list…']

  const start = () => {
    if (setup.remember) saveKeys({ openrouter: tableSetup.openrouterKey, typesafe: tableSetup.typesafeKey, remember: true })
    else {
      forgetKeys()
      saveKeys({ openrouter: tableSetup.openrouterKey, typesafe: tableSetup.typesafeKey, remember: false })
    }
    const t = new LocalTable(
      tableSetup,
      { catalog: new Map((catalog ?? []).map((m) => [m.id, m])), relayBase: `${window.location.origin}/api/typesafe`, referer: window.location.origin, paceMs },
      dispatch,
    )
    table.current = t
    setSpent(0)
    setPhase('playing')
    t.start().then(
      () => {
        setSpent(t.spentUsd())
        setPhase('over')
      },
      () => setPhase('over'),
    )
  }

  const signIn = () => {
    beginSignIn(`${window.location.origin}/play`).then((link) => window.location.assign(link), (e: unknown) => setSignInError((e as Error).message))
  }

  if (phase === 'setup') {
    return (
      <div className="page play">
        {signInError ? <p className="warn">{signInError}</p> : null}
        <PlaySetup value={setup} onChange={setSetup} models={models} modelsError={catalogError} problems={problems} onSignIn={signIn} onStart={start} />
      </div>
    )
  }

  const controls = (
    <span className="controls">
      {phase === 'playing' ? (
        <button type="button" onClick={() => table.current?.stop()}>
          Stop after this hand
        </button>
      ) : (
        <button type="button" onClick={() => setPhase('setup')}>
          New table
        </button>
      )}
      <span className="progress">
        spent {usd(spent)} of {usd(setup.budgetUsd)}
      </span>
    </span>
  )
  return <Broadcast channel={feed.channel} view={feed.view} log={feed.log} decisionEquity={feed.decisionEquity} controls={controls} />
}
```

- [ ] **Step 5: Add the page and the nav link.** Create `apps/web/app/play/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { PlayScreen } from '../../components/play/PlayScreen'

export const metadata: Metadata = { title: 'Run your own table · artificialBluff' }

export default function Play() {
  return <PlayScreen />
}
```

In `apps/web/app/layout.tsx`, add `<Link href="/play">Play</Link>` right after `<Link href="/">Table</Link>`.

- [ ] **Step 6: Add the styles.** Append to `apps/web/app/globals.css`:

```css
/* ---- run your own table ---- */
.play-setup {
  max-width: 760px;
}
.play-setup fieldset {
  border: 1px solid var(--rule);
  border-radius: 6px;
  background: var(--panel);
  margin: 0 0 14px;
  padding: 10px 14px 12px;
}
.play-setup legend {
  color: var(--brass);
  font-weight: 600;
  padding: 0 6px;
}
.play-setup input,
.play-setup select,
.play-setup button {
  font: inherit;
  background: var(--panel-2);
  color: var(--cream);
  border: 1px solid var(--rule);
  border-radius: 4px;
  padding: 5px 8px;
}
.play-setup button {
  cursor: pointer;
}
.seat-choice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
}
.seat-choice b {
  width: 70px;
  font-family: var(--font-display), 'Barlow Condensed', sans-serif;
}
.seat-choice input {
  flex: 1;
  min-width: 220px;
}
.seat-choice small,
.play-setup .notice,
.play-setup .estimate {
  color: var(--muted);
}
.play-setup .notice {
  font-size: 13px;
  border-left: 3px solid var(--brass);
  padding-left: 8px;
}
.play-setup .ok {
  color: var(--brass);
}
.play-setup .problems {
  color: var(--alert);
}
.play-setup .start {
  background: var(--brass);
  color: var(--felt);
  font-weight: 700;
  border: 0;
  padding: 8px 18px;
}
.play-setup .start:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
```

- [ ] **Step 7: Run the tests.** Run `pnpm --filter @ab/web test && pnpm --filter @ab/web typecheck`. Expected: all pass (43 web tests).
- [ ] **Step 8: Build.** Run `pnpm --filter @ab/web build`. Expected: the route list includes `○ /play` and `ƒ /api/typesafe/[...path]`, with no "Module not found" for `better-sqlite3` or `node:*`. Afterwards, delete `apps/web/.next` if disk space is short.
- [ ] **Step 9: Commit.** `git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(web): /play, run your own table"`


### Task 7: Docs

**Files:**
- Modify: `docs/superpowers/specs/2026-09-21-artificialbluff-design.md`, `docs/STATUS.md`, `CLAUDE.md`, `docs/deploy.md`, `apps/web/app/about/page.tsx` (only if it lists the site's sections)

- [ ] **Step 1: Update the spec.** Add a section "Run your own table (Plan 5)" covering:
  - /play: seats are Jev (first seat only), any supported OpenRouter model, or a free bot.
  - The game runs in the visitor's browser (`LocalTable`, `MemoryStore`, `@ab/core/browser`).
  - Keys: kept in the tab, or on the device if the visitor opts in. Sign in with OpenRouter uses PKCE.
  - Model calls go straight to OpenRouter. Jev calls go through the stateless relay `/api/typesafe/v1/systemone`, which only exists because TypeSafe blocks browser calls. It has a path allowlist, an origin check, a 64 KB body cap, a limit of 120 calls per minute per address, and no logging.
  - Supported models: text in and out, `structured_outputs`, no `:free`, `:batch` or `~` variants, at most $0.02 per decision.
  - The estimate assumes 120 decisions per seat. The cap defaults to $1 (range $0.10 to $20).
  - Browser tables are never stored on our server and never mixed into research results.
- [ ] **Step 2: Update STATUS.** Add Plan 5 to the plan series and the execution log. Record the open item: ask TypeSafe to allow browser calls (CORS), then remove the relay.
- [ ] **Step 3: Update CLAUDE.md.** Add one line: "`/play` runs a table in the visitor's browser with their own keys (Plan 5). Jev calls go through the `/api/typesafe` relay until TypeSafe allows browser calls."
- [ ] **Step 4: Update the deploy guide.** Add to `docs/deploy.md` that the web container relays Jev calls for /play (outbound HTTPS to api.typesafe.ai) and needs no extra settings.
- [ ] **Step 5: Final check.** Run `pnpm test && pnpm typecheck`. Expected: all pass (443 tests).
- [ ] **Step 6: Commit.** `git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "docs: run your own table (Plan 5)"`
