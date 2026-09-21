# artificialBluff Plan 3a: Study Runner

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the pre-registered duplicate study: seed groups with neighbour-balanced seating, played by the real players (or free mocks), with a hard budget cap checked before every decision, crash/budget-safe resume, and a CI-based stopping rule over whole neighbour blocks. Ships `pnpm study prereg|run|status`.

**Architecture:** A new package `apps/study` (`@ab/study`). `parseStudyConfig` validates a JSON study file. `preregistration` builds the record hashed into the study's game config before hand 1 (everything that affects results; not budget or concurrency, so a study can be topped up and resumed). `runStudy` plays hands in group order with N workers through `playHand`, tags each hand with its place in the duplicate schedule, and after every completed hand checks the stopping rule over the **completed prefix** of groups in whole neighbour blocks (no cherry-picking). Hands cut short by the budget cap are excluded and replayed as a new attempt on resume. Two small core additions: `DuplicateInfo` on `hand_started`, and a `study_ended` event.

**Tech Stack:** as Plans 1–2 (TypeScript strict, Vitest, better-sqlite3 via `@ab/core`, `tsx` for the CLI).

**Spec:** `docs/superpowers/specs/2026-09-21-artificialbluff-design.md` §4 (duplicate + neighbour blocks), §6 (study runner, pre-registration, budget, resume, stopping). Status/todos: `docs/STATUS.md`.

**Plan series:** 1 Engine (merged) → 2 Players, runner, event log (merged) → **3a Study runner (this)** → 3b Analysis and report (bb/100, cost, latency, calibration A and C, play style, exports, HTML) → 4 Live server and web.

---

## Notes for the implementer

- **Duplicate:** each seed group plays one deck once per seat rotation (5 hands for 5 players) on a base seating that varies by group; every block of 4 groups balances who sits next to whom (`neighbourBlockSize`). Results use whole blocks only.
- **Hand ids:** `"<group>:<rotation>#<attempt>"`. A hand is valid if it reached `hand_ended` and no decision in it was auto-played because the budget cap was hit (`fallbackReason === 'auto: budget cap reached'`). Invalid attempts are simply superseded by the next attempt on resume; nothing is deleted.
- **Stopping rule:** every `checkEvery` completed groups, over the completed prefix (groups 0..k-1 all valid), truncated to whole blocks: stop when every player's 95% bootstrap CI half-width of bb/100 is ≤ target; never before `minGroups`; at most `maxGroups`.
- **bb/100:** per group, a player's net over all rotations ÷ rotations ÷ big blind × 100 (each player plays one hand per rotation); block value = mean of its groups; bootstrap resamples blocks.
- **Pre-registration:** `configHash(preregistration(...))` is stored as the study game's config hash. Resuming with a different record is refused. Budget and concurrency are deliberately not in it.
- **Money:** never run `pnpm study run` without `--mock` unless the user explicitly says so. `--mock` swaps paid seats for free mocks under `<id>-mock`.

## File map

| File | Responsibility |
|---|---|
| `packages/core/src/events.ts` (modify) | `DuplicateInfo` on `hand_started`; `StudyEndReason`; `study_ended` event |
| `packages/core/src/runner.ts` (modify) | `playHand({ duplicate })` records it on `hand_started` |
| `apps/study/src/config.ts` | `StudyConfig`, `parseStudyConfig` |
| `apps/study/src/stats.ts` | `bootstrapMean` |
| `apps/study/src/progress.ts` | Rebuild progress from events (resume); completed prefix |
| `apps/study/src/results.ts` | bb/100 per player with block-bootstrap CIs |
| `apps/study/src/prereg.ts` | The pre-registration record |
| `apps/study/src/run.ts` | `runStudy` |
| `apps/study/src/commands.ts`, `cli.ts` | `pnpm study prereg|run|status [--mock]` |
| `studies/*.example.json` | Smoke and main study configs |

---

### Task 1: Study hands in the core event stream

**Files:**
- Modify: `packages/core/src/events.ts`, `packages/core/src/runner.ts`
- Test: `packages/core/test/runner.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/core/test/runner.test.ts`, add immediately before `it('rejects a config with a seat that has no player', ...)`:
```ts
  it('records study hands\' place in the duplicate schedule on hand_started', async () => {
    const sink = memorySink()
    const duplicate = { groupIndex: 3, rotation: 2, order: 4, seed: 123, attempt: 1 }
    await playHand({ config: config(['a', 'b']), players: byId([new CallingStation('a'), new CallingStation('b')]), sink, decisionTimeoutMs: 100, duplicate })
    expect(sink.events[0]).toMatchObject({ type: 'hand_started', duplicate })
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/core exec vitest run test/runner.test.ts`
Expected: FAIL (`duplicate` missing from `hand_started`).

- [ ] **Step 3: Implement**

In `packages/core/src/events.ts`, replace the line `export type GameKind = 'live' | 'study'` with:
```ts
export type GameKind = 'live' | 'study'

/** Where a study hand sits in the duplicate schedule. */
export interface DuplicateInfo {
  groupIndex: number
  rotation: number
  /** Base seating order of the group (multiplier k, or 0 for a seeded shuffle). */
  order: number
  /** Deck seed shared by the group's rotations. */
  seed: number
  /** 1 for the first try; a hand interrupted (crash, budget cap) is replayed with the next attempt. */
  attempt: number
}

/** Why a study stopped: CI target met, all groups played, budget reached, or stopped early. */
export type StudyEndReason = 'ci_target' | 'max_groups' | 'budget_cap' | 'interrupted'
```
In the `hand_started` member of `EventBody`, after the `posts: ...` line add:
```ts
      /** Study hands only. */
      duplicate?: DuplicateInfo
```
and add a new member to `EventBody` after the `game_ended` member:
```ts
  | {
      type: 'study_ended'
      reason: StudyEndReason
      /** Seed groups completed in order from group 0 (the prefix the results use). */
      groupsCompleted: number
      handsPlayed: number
      costUsd: number
    }
```

In `packages/core/src/runner.ts`: change the events import to `import type { DuplicateInfo, EventSink, FallbackKind } from './events'`; add to `PlayHandOptions` after `stopSpending?`:
```ts
  /** Study hands: recorded on hand_started. */
  duplicate?: DuplicateInfo
```
and in the `hand_started` append, after the `posts: ...` property add:
```ts
    ...(opts.duplicate ? { duplicate: opts.duplicate } : {}),
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/core exec vitest run && pnpm --filter @ab/core exec tsc --noEmit`
Expected: PASS (34 tests); typecheck clean.

- [ ] **Step 5: Commit**


```bash
git add packages/core/src/events.ts packages/core/src/runner.ts packages/core/test/runner.test.ts
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(core): duplicate info on study hands; study_ended event" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```


---

### Task 2: Study package and config

**Files:**
- Create: `apps/study/package.json`, `apps/study/tsconfig.json`, `apps/study/src/config.ts`
- Test: `apps/study/test/config.test.ts`

- [ ] **Step 1: Create the package**

`apps/study/package.json`:

```json
{
  "name": "@ab/study",
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
    "@ab/engine": "workspace:*",
    "@ab/players": "workspace:*"
  }
}
```

`apps/study/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Run: `pnpm install` (links the workspace packages).

- [ ] **Step 2: Write the failing test**

`apps/study/test/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseStudyConfig } from '../src/config'

const lineup = ['jev', 'pill', 'block', 'drip', 'nimbus'].map((id) => ({ id, kind: 'mock' as const }))
const base = { id: 'pilot', lineup, masterSeed: 'm', budgetUsd: 5, targetHalfWidthBb100: 10, minGroups: 8, maxGroups: 40 }

describe('parseStudyConfig', () => {
  it('fills defaults', () => {
    expect(parseStudyConfig(base)).toMatchObject({
      format: { smallBlind: 50, bigBlind: 100, stackInBigBlinds: 100 },
      decisionTimeoutMs: 20_000,
      checkEvery: 20,
      concurrency: 2,
      bootstrapResamples: 2000,
    })
  })

  it('requires group counts in whole neighbour blocks (4 for 5 players)', () => {
    expect(() => parseStudyConfig({ ...base, minGroups: 6 })).toThrow(/multiple of the neighbour block \(4 for 5 players\)/)
    expect(() => parseStudyConfig({ ...base, checkEvery: 10 })).toThrow(/checkEvery/)
    expect(() => parseStudyConfig({ ...base, minGroups: 44 })).toThrow(/cannot exceed/)
  })

  it('rejects bad values', () => {
    expect(() => parseStudyConfig({ ...base, id: 'no spaces allowed' })).toThrow(/id/)
    expect(() => parseStudyConfig({ ...base, budgetUsd: 0 })).toThrow(/budgetUsd/)
    expect(() => parseStudyConfig({ ...base, budgetUsd: Number.NaN })).toThrow(/budgetUsd/)
    expect(() => parseStudyConfig({ ...base, lineup: [lineup[0], lineup[0]] })).toThrow(/unique/)
    expect(() => parseStudyConfig({ ...base, concurrency: 50 })).toThrow(/concurrency/)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @ab/study exec vitest run`
Expected: FAIL, cannot resolve `../src/config`.

- [ ] **Step 4: Implement**

`apps/study/src/config.ts`:

```ts
import { neighbourBlockSize, STUDY_CASH, type CashFormat } from '@ab/engine'
import type { PlayerSpec } from '@ab/players'

/** A study, as written in a JSON file. Everything here is pre-registered (hashed before hand 1). */
export interface StudyConfig {
  /** Study id; also the game id in the event store. */
  id: string
  /** Seats, one player each. Identical line-up on every hand; seating rotates. */
  lineup: PlayerSpec[]
  /** Master seed for deck seeds, seating shuffles and the bootstrap. */
  masterSeed: string
  /** Cash format; defaults to 50/100 blinds, 100 bb stacks. */
  format: CashFormat
  /** Per-decision time limit. */
  decisionTimeoutMs: number
  /** Hard spending cap (USD), checked before every decision. */
  budgetUsd: number
  /** Stop when every player's 95% CI half-width for bb/100 is at most this. */
  targetHalfWidthBb100: number
  /** Never stop on the CI before this many groups (a multiple of the neighbour block). */
  minGroups: number
  /** Stop after this many groups (a multiple of the neighbour block). */
  maxGroups: number
  /** Check the stopping rule every this many completed groups (a multiple of the neighbour block). */
  checkEvery: number
  /** Hands played at once. */
  concurrency: number
  /** Bootstrap resamples for the CIs. */
  bootstrapResamples: number
}

type Raw = Record<string, unknown>

function num(raw: Raw, key: string, fallback?: number): number {
  const v = raw[key] ?? fallback
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`study config: "${key}" must be a finite number`)
  return v
}

function int(raw: Raw, key: string, min: number, fallback?: number): number {
  const v = num(raw, key, fallback)
  if (!Number.isInteger(v) || v < min) throw new Error(`study config: "${key}" must be an integer ≥ ${min}`)
  return v
}

/** Parses and validates a study config (from JSON), filling defaults. */
export function parseStudyConfig(input: unknown): StudyConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('study config must be a JSON object')
  const raw = input as Raw
  if (typeof raw.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(raw.id)) throw new Error('study config: "id" must be a simple name')
  if (typeof raw.masterSeed !== 'string' || raw.masterSeed === '') throw new Error('study config: "masterSeed" must be a non-empty string')
  if (!Array.isArray(raw.lineup) || raw.lineup.length < 2) throw new Error('study config: "lineup" needs at least 2 players')
  const lineup = raw.lineup as PlayerSpec[]
  const ids = lineup.map((p) => p?.id)
  if (ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error('study config: lineup ids must be unique strings')

  const format = (raw.format ?? STUDY_CASH) as CashFormat
  for (const k of ['smallBlind', 'bigBlind', 'stackInBigBlinds'] as const) {
    if (!Number.isInteger(format[k]) || format[k] <= 0) throw new Error(`study config: "format.${k}" must be a positive integer`)
  }

  const block = neighbourBlockSize(lineup.length)
  const config: StudyConfig = {
    id: raw.id,
    lineup,
    masterSeed: raw.masterSeed,
    format,
    decisionTimeoutMs: int(raw, 'decisionTimeoutMs', 1000, 20_000),
    budgetUsd: num(raw, 'budgetUsd'),
    targetHalfWidthBb100: num(raw, 'targetHalfWidthBb100'),
    minGroups: int(raw, 'minGroups', block),
    maxGroups: int(raw, 'maxGroups', block),
    checkEvery: int(raw, 'checkEvery', block, 20),
    concurrency: int(raw, 'concurrency', 1, 2),
    bootstrapResamples: int(raw, 'bootstrapResamples', 200, 2000),
  }
  if (config.budgetUsd <= 0) throw new Error('study config: "budgetUsd" must be positive')
  if (config.targetHalfWidthBb100 <= 0) throw new Error('study config: "targetHalfWidthBb100" must be positive')
  if (config.concurrency > 16) throw new Error('study config: "concurrency" must be at most 16')
  for (const k of ['minGroups', 'maxGroups', 'checkEvery'] as const) {
    if (config[k] % block !== 0) throw new Error(`study config: "${k}" must be a multiple of the neighbour block (${block} for ${lineup.length} players)`)
  }
  if (config.minGroups > config.maxGroups) throw new Error('study config: "minGroups" cannot exceed "maxGroups"')
  return config
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @ab/study exec vitest run && pnpm --filter @ab/study exec tsc --noEmit`
Expected: PASS (3 tests); typecheck clean.

- [ ] **Step 6: Commit**


```bash
git add apps/study/package.json apps/study/tsconfig.json apps/study/src/config.ts apps/study/test/config.test.ts pnpm-lock.yaml
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(study): study package and validated study config" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```


---

### Task 3: Bootstrap confidence intervals

**Files:**
- Create: `apps/study/src/stats.ts`
- Test: `apps/study/test/stats.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/study/test/stats.test.ts`:

```ts
import { deriveSeed, mulberry32 } from '@ab/engine'
import { describe, expect, it } from 'vitest'
import { bootstrapMean } from '../src/stats'

describe('bootstrapMean', () => {
  it('is deterministic for a seed and brackets the mean', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const a = bootstrapMean(values, 2000, 's')
    expect(bootstrapMean(values, 2000, 's')).toEqual(a)
    expect(a.mean).toBe(5.5)
    expect(a.low).toBeLessThan(5.5)
    expect(a.high).toBeGreaterThan(5.5)
    expect(a.halfWidth).toBeCloseTo((a.high - a.low) / 2)
  })

  it('has roughly the right coverage on synthetic data (about 95%)', () => {
    // True mean 0, sd 1, n = 40: the CI should contain 0 in roughly 95% of 400 trials.
    let covered = 0
    for (let t = 0; t < 400; t++) {
      const rand = mulberry32(deriveSeed('cov', t))
      const values = Array.from({ length: 40 }, () => {
        // Box-Muller normal
        const u = Math.max(rand(), 1e-12)
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
      })
      const ci = bootstrapMean(values, 1000, `b${t}`)
      if (ci.low <= 0 && 0 <= ci.high) covered++
    }
    expect(covered / 400).toBeGreaterThan(0.9)
    expect(covered / 400).toBeLessThan(0.98)
  })

  it('reports an infinite interval with fewer than two values', () => {
    expect(bootstrapMean([3], 1000, 's').halfWidth).toBe(Number.POSITIVE_INFINITY)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/study exec vitest run test/stats.test.ts`
Expected: FAIL, cannot resolve `../src/stats`.

- [ ] **Step 3: Implement**

`apps/study/src/stats.ts`:

```ts
import { deriveSeed, mulberry32 } from '@ab/engine'

export interface Interval {
  mean: number
  low: number
  high: number
  /** (high - low) / 2 */
  halfWidth: number
}

/** Mean of `values` with a percentile bootstrap CI (resampling the values with replacement). */
export function bootstrapMean(values: readonly number[], resamples: number, seed: string, level = 0.95): Interval {
  const n = values.length
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : Number.NaN
  if (n < 2) return { mean, low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY, halfWidth: Number.POSITIVE_INFINITY }
  const rand = mulberry32(deriveSeed('bootstrap', seed))
  const means = new Array<number>(resamples)
  for (let r = 0; r < resamples; r++) {
    let sum = 0
    for (let i = 0; i < n; i++) sum += values[Math.floor(rand() * n)]!
    means[r] = sum / n
  }
  means.sort((a, b) => a - b)
  const tail = (1 - level) / 2
  const pick = (q: number) => means[Math.min(resamples - 1, Math.max(0, Math.floor(q * resamples)))]!
  const low = pick(tail)
  const high = pick(1 - tail)
  return { mean, low, high, halfWidth: (high - low) / 2 }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @ab/study exec vitest run`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**


```bash
git add apps/study/src/stats.ts apps/study/test/stats.test.ts
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(study): percentile bootstrap CIs" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```


---

### Task 4: Study runner (progress, results, pre-registration, run)

**Files:**
- Create: `apps/study/src/progress.ts`, `apps/study/src/results.ts`, `apps/study/src/prereg.ts`, `apps/study/src/run.ts`, `apps/study/src/index.ts`
- Test: `apps/study/test/run.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/study/test/run.test.ts` (all free: bots and mocks):

```ts
import { EventStore, type GameEvent } from '@ab/core'
import { CallingStation, MockLlm, RandomBot, TagBot, type Player } from '@ab/players'
import { describe, expect, it } from 'vitest'
import { parseStudyConfig, type StudyConfig } from '../src/config'
import { preregistration } from '../src/prereg'
import { BUDGET_CAP_REASON, readStoreProgress } from '../src/progress'
import { runStudy } from '../src/run'

const ids = ['jev', 'pill', 'block', 'drip', 'nimbus']

function config(over: Record<string, unknown> = {}): StudyConfig {
  return parseStudyConfig({
    id: 'pilot',
    lineup: ids.map((id) => ({ id, kind: 'mock' })),
    masterSeed: 'm',
    budgetUsd: 100,
    targetHalfWidthBb100: 1000,
    minGroups: 8,
    maxGroups: 16,
    checkEvery: 4,
    concurrency: 1,
    bootstrapResamples: 500,
    decisionTimeoutMs: 1000,
    ...over,
  })
}

const run = (c: StudyConfig, players: Player[], store: EventStore, signal?: AbortSignal) =>
  runStudy({ config: c, players, store, prereg: preregistration(c, c.lineup), ...(signal ? { signal } : {}) })

const tags = () => ids.map((id) => new TagBot(id))

describe('runStudy', () => {
  it('duplicate play cancels luck: identical players break exactly even', async () => {
    const store = new EventStore()
    const out = await run(config({ targetHalfWidthBb100: 0.001 }), tags(), store)
    expect(out.reason).toBe('ci_target') // every CI is exactly [0, 0]
    expect(out.groupsCompleted).toBe(8) // stops at minGroups
    for (const p of out.summary.players) expect(p.bb100).toMatchObject({ mean: 0, halfWidth: 0 })
  })

  it('records the duplicate schedule on every hand', async () => {
    const store = new EventStore()
    await run(config({ maxGroups: 4, minGroups: 4 }), tags(), store)
    const starts = store.events('pilot').filter((e): e is Extract<GameEvent, { type: 'hand_started' }> => e.type === 'hand_started')
    expect(starts).toHaveLength(20)
    expect(starts[0]).toMatchObject({ handId: '0:0#1', duplicate: { groupIndex: 0, rotation: 0, attempt: 1, order: 1 } })
    expect(new Set(starts.map((s) => s.handId)).size).toBe(20)
  })

  it('plays every group up to maxGroups when the CI target is out of reach', async () => {
    const store = new EventStore()
    const players = [new TagBot('jev'), new CallingStation('pill'), new RandomBot('block', 1), new TagBot('drip'), new CallingStation('nimbus')]
    const out = await run(config({ targetHalfWidthBb100: 0.001 }), players, store)
    expect(out.reason).toBe('max_groups')
    expect(out.groupsCompleted).toBe(16)
    expect(out.summary).toMatchObject({ groups: 16, blocks: 4 })
    expect(out.summary.players.reduce((s, p) => s + p.bb100.mean, 0)).toBeCloseTo(0, 6) // zero-sum
    const last = store.events('pilot').at(-1)!
    expect(last).toMatchObject({ type: 'study_ended', reason: 'max_groups', groupsCompleted: 16, handsPlayed: 80 })
  })

  it('stops at the budget cap, excludes cut-off hands, and replays them when resumed with more budget', async () => {
    const store = new EventStore()
    // Paid mock seats plus two calling stations, so results vary and the CI can't close early.
    const pricey = () => ids.map((id, i) => (i < 3 ? new MockLlm(id, 'mock/pricey', { inputPricePerMTok: 50 }) : new CallingStation(id)))
    const first = await run(config({ budgetUsd: 2, targetHalfWidthBb100: 0.001 }), pricey(), store)
    expect(first.reason).toBe('budget_cap')
    const capped = store.events('pilot').filter((e) => e.type === 'decision' && e.fallbackReason === BUDGET_CAP_REASON)
    expect(capped.length).toBeGreaterThan(0)
    const before = readStoreProgress(store, 'pilot')
    expect(before.valid.size).toBeLessThan(before.attempts.size) // at least one started hand doesn't count

    // Top up: same pre-registration (budget isn't hashed), so the study resumes.
    const second = await run(config({ budgetUsd: 50, targetHalfWidthBb100: 0.001 }), pricey(), store)
    expect(second.reason).toBe('max_groups')
    expect(second.configHash).toBe(first.configHash)
    const after = readStoreProgress(store, 'pilot')
    expect(after.valid.size).toBe(80)
    expect([...after.attempts.values()].some((a) => a > 1)).toBe(true) // a cut-off hand was replayed
  })

  it('refuses to resume with a different pre-registration', async () => {
    const store = new EventStore()
    await run(config({ maxGroups: 4, minGroups: 4 }), tags(), store)
    await expect(run(config({ maxGroups: 4, minGroups: 4, masterSeed: 'other' }), tags(), store)).rejects.toThrow(/different config/)
  })

  it('does nothing more once a study has finished', async () => {
    const store = new EventStore()
    await run(config({ maxGroups: 4, minGroups: 4 }), tags(), store)
    const count = store.events('pilot').length
    const again = await run(config({ maxGroups: 4, minGroups: 4 }), tags(), store)
    expect(again.reason).toBe('max_groups')
    expect(store.events('pilot')).toHaveLength(count)
  })

  it('gives the same results with parallel tables as with one', async () => {
    const mixed = () => [new TagBot('jev'), new CallingStation('pill'), new MockLlm('block'), new TagBot('drip'), new CallingStation('nimbus')]
    const a = await run(config({ concurrency: 1 }), mixed(), new EventStore())
    const b = await run(config({ concurrency: 4 }), mixed(), new EventStore())
    expect(b.summary.players.map((p) => p.bb100.mean)).toEqual(a.summary.players.map((p) => p.bb100.mean))
  })

  it('stops as interrupted when aborted, and can be resumed', async () => {
    const store = new EventStore()
    const ac = new AbortController()
    ac.abort()
    const first = await run(config(), tags(), store, ac.signal)
    expect(first.reason).toBe('interrupted')
    expect(store.game('pilot')!.status).toBe('interrupted')
    const second = await run(config(), tags(), store) // same pre-registration
    expect(second.reason).toBe('ci_target')
  })

  it('pre-registers everything that affects results, but not budget or concurrency', () => {
    const c = config()
    const record = preregistration(c, c.lineup) as { study: Record<string, unknown>; prompts: Record<string, string> }
    expect(record.study).not.toHaveProperty('budgetUsd')
    expect(record.study).not.toHaveProperty('concurrency')
    expect(record.study).toMatchObject({ masterSeed: 'm', targetHalfWidthBb100: 1000, decisionTimeoutMs: 1000 })
    expect(record.prompts.llmSystem).toContain('win this hand')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/study exec vitest run test/run.test.ts`
Expected: FAIL, cannot resolve `../src/prereg`.

- [ ] **Step 3: Implement**

`apps/study/src/progress.ts`:

```ts
import type { EventStore, GameEvent, StudyEndReason } from '@ab/core'

/** The auto reason playHand records once the spending cap stops play mid-hand. */
export const BUDGET_CAP_REASON = 'auto: budget cap reached'

export const handKeyOf = (groupIndex: number, rotation: number) => `${groupIndex}:${rotation}`

/** What the event log says about a study so far. */
export interface StudyProgress {
  /** handKey -> highest attempt number started. */
  attempts: Map<string, number>
  /** handKey -> chips won/lost per player, for the valid (completed, never budget-capped) attempt. */
  valid: Map<string, Record<string, number>>
  handsPlayed: number
  lastEnd: StudyEndReason | null
}

export function emptyProgress(): StudyProgress {
  return { attempts: new Map(), valid: new Map(), handsPlayed: 0, lastEnd: null }
}

/**
 * Rebuilds progress from a study's events (for resume). A hand attempt counts only if it reached
 * hand_ended and no decision in it was auto-played because the budget cap was hit.
 */
export function readProgress(events: readonly GameEvent[]): StudyProgress {
  const p = emptyProgress()
  const byHandId = new Map<string, { key: string; capped: boolean }>()
  for (const e of events) {
    if (e.type === 'hand_started' && e.duplicate && e.handId) {
      const key = handKeyOf(e.duplicate.groupIndex, e.duplicate.rotation)
      byHandId.set(e.handId, { key, capped: false })
      p.attempts.set(key, Math.max(p.attempts.get(key) ?? 0, e.duplicate.attempt))
    } else if (e.type === 'decision' && e.handId && e.fallbackReason === BUDGET_CAP_REASON) {
      const h = byHandId.get(e.handId)
      if (h) h.capped = true
    } else if (e.type === 'hand_ended' && e.handId) {
      p.handsPlayed++
      const h = byHandId.get(e.handId)
      if (h && !h.capped && !p.valid.has(h.key)) p.valid.set(h.key, e.net)
    } else if (e.type === 'study_ended') {
      p.lastEnd = e.reason
    }
  }
  return p
}

export function readStoreProgress(store: EventStore, gameId: string): StudyProgress {
  return readProgress(store.events(gameId))
}

/** Number of groups complete in order from group 0 (every rotation has a valid hand). */
export function completedPrefix(p: StudyProgress, players: number, maxGroups: number): number {
  let g = 0
  while (g < maxGroups) {
    for (let r = 0; r < players; r++) if (!p.valid.has(handKeyOf(g, r))) return g
    g++
  }
  return g
}
```

`apps/study/src/results.ts`:

```ts
import { neighbourBlockSize } from '@ab/engine'
import type { StudyConfig } from './config'
import { handKeyOf, type StudyProgress } from './progress'
import { bootstrapMean, type Interval } from './stats'

export interface PlayerResult {
  playerId: string
  /** Big blinds won per 100 hands, with a 95% bootstrap CI over neighbour blocks. */
  bb100: Interval
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
  const n = config.lineup.length
  const block = neighbourBlockSize(n)
  const blocks = Math.floor(prefixGroups / block)
  const groups = blocks * block
  const bb = config.format.bigBlind
  const players = config.lineup.map((spec): PlayerResult => {
    const blockValues: number[] = []
    for (let b = 0; b < blocks; b++) {
      let sum = 0
      for (let g = b * block; g < (b + 1) * block; g++) {
        let net = 0
        for (let r = 0; r < n; r++) net += p.valid.get(handKeyOf(g, r))![spec.id] ?? 0
        sum += (net / n / bb) * 100
      }
      blockValues.push(sum / block)
    }
    return {
      playerId: spec.id,
      bb100: bootstrapMean(blockValues, config.bootstrapResamples, `${config.masterSeed}:${spec.id}`),
      hands: groups * n,
    }
  })
  return { groups, blocks, players }
}
```

`apps/study/src/prereg.ts`:

```ts
import { DEFAULT_MENU_CONFIG, neighbourBlockSize } from '@ab/engine'
import { ACTION_INSTRUCTIONS, JEV_INPUT_PRICE_PER_MTOK, SYSTEM_PROMPT, WIN_INSTRUCTIONS, type PlayerSpec } from '@ab/players'
import type { StudyConfig } from './config'

/**
 * The pre-registration record: everything that can affect results, hashed into the study's game
 * config before hand 1. Budget and concurrency are left out on purpose: they only decide how far a
 * run gets, so topping up the budget and resuming doesn't change the study.
 */
export function preregistration(config: StudyConfig, adaptedLineup: PlayerSpec[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  const { budgetUsd: _budget, concurrency: _concurrency, lineup: _lineup, ...rest } = config
  return {
    kind: 'artificialBluff study',
    version: 1,
    study: { ...rest, lineup: adaptedLineup },
    seating: { design: 'duplicate, cyclic rotations of a per-group base order', neighbourBlock: neighbourBlockSize(adaptedLineup.length) },
    menu: DEFAULT_MENU_CONFIG,
    prompts: { llmSystem: SYSTEM_PROMPT, jevAction: ACTION_INSTRUCTIONS, jevWin: WIN_INSTRUCTIONS },
    prices: { jevInputUsdPerMTok: JEV_INPUT_PRICE_PER_MTOK, llm: 'as reported per call by OpenRouter (usage.cost)' },
    outcomes: {
      calibrationHeadline: 'main-pot share: 1 if won alone, 1/k if split k ways, 0 if lost or folded at any point',
      calibrationSecond: 'expected main-pot share at decision time from all hole cards (exact enumeration)',
    },
    stopping:
      'every checkEvery groups: over the completed prefix of groups in whole neighbour blocks, stop when every ' +
      "player's 95% bootstrap CI half-width of bb/100 is at most targetHalfWidthBb100; never before minGroups; " +
      'at most maxGroups; hands cut short by the budget cap are excluded and replayed on resume',
    ...extra,
  }
}
```

`apps/study/src/run.ts`:

```ts
import { configHash, playHand, type EventStore, type StudyEndReason } from '@ab/core'
import { cashHandConfig, duplicateGroup, type DuplicateHand } from '@ab/engine'
import type { Player } from '@ab/players'
import type { StudyConfig } from './config'
import { BUDGET_CAP_REASON, completedPrefix, handKeyOf, readStoreProgress } from './progress'
import { summarize, type StudySummary } from './results'

export interface RunStudyOptions {
  config: StudyConfig
  /** Players for the line-up, in any order (matched by id). */
  players: Player[]
  store: EventStore
  /** The pre-registration record (see `preregistration`); its hash must not change across resumes. */
  prereg: Record<string, unknown>
  /** Stops scheduling new hands; hands in flight finish. */
  signal?: AbortSignal
  /** Called each time the stopping rule is checked. */
  onCheckpoint?: (summary: StudySummary, costUsd: number) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface StudyOutcome {
  reason: StudyEndReason
  /** Completed prefix of groups (before truncating to whole blocks). */
  groupsCompleted: number
  summary: StudySummary
  costUsd: number
  configHash: string
}

/**
 * Runs (or resumes) a duplicate study. Hands are played in group order by `concurrency` workers.
 * Results always use the completed prefix of groups in whole neighbour blocks, so the stopping rule
 * can't pick favourable groups. Hands cut short by the budget cap don't count and are replayed
 * (as a new attempt) when the study is resumed with more budget.
 */
export async function runStudy(opts: RunStudyOptions): Promise<StudyOutcome> {
  const { config, store } = opts
  const n = config.lineup.length
  const players = new Map(opts.players.map((p) => [p.id, p]))
  for (const spec of config.lineup) if (!players.has(spec.id)) throw new Error(`no player for line-up seat ${spec.id}`)
  const ids = config.lineup.map((s) => s.id)

  const hash = configHash(opts.prereg)
  const existing = store.game(config.id)
  if (existing) {
    if (existing.kind !== 'study') throw new Error(`${config.id} is not a study`)
    if (existing.configHash !== hash) throw new Error(`study ${config.id} was pre-registered with a different config (hash ${existing.configHash.slice(0, 12)}…); use a new id`)
  } else {
    store.createGame(config.id, 'study', opts.prereg)
  }
  const progress = readStoreProgress(store, config.id)
  const summaryNow = () => summarize(progress, config, completedPrefix(progress, n, config.maxGroups))
  if (progress.lastEnd === 'ci_target' || progress.lastEnd === 'max_groups') {
    return { reason: progress.lastEnd, groupsCompleted: completedPrefix(progress, n, config.maxGroups), summary: summaryNow(), costUsd: store.gameCost(config.id), configHash: hash }
  }
  if (existing) store.setStatus(config.id, 'running')
  const sink = store.sink(config.id)
  sink.append({ type: 'game_started', kind: 'study', configHash: hash, players: opts.players.map((p) => ({ id: p.id, kind: p.kind, model: p.model })) })

  const overBudget = () => store.gameCost(config.id) >= config.budgetUsd
  let stop: StudyEndReason | null = null
  let failure: unknown = null
  let checkedAt = completedPrefix(progress, n, config.maxGroups)

  function checkpoint(): void {
    const prefix = completedPrefix(progress, n, config.maxGroups)
    if (prefix < checkedAt + config.checkEvery && prefix < config.maxGroups) return
    checkedAt = prefix - (prefix % config.checkEvery)
    const summary = summarize(progress, config, prefix)
    opts.onCheckpoint?.(summary, store.gameCost(config.id))
    if (prefix >= config.minGroups && summary.players.every((p) => p.bb100.halfWidth <= config.targetHalfWidthBb100)) {
      stop ??= 'ci_target'
    }
  }

  function* tasks(): Generator<DuplicateHand> {
    for (let g = 0; g < config.maxGroups; g++) {
      for (const hand of duplicateGroup(config.masterSeed, g, ids)) {
        if (!progress.valid.has(handKeyOf(hand.groupIndex, hand.rotation))) yield hand
      }
    }
  }
  const queue = tasks()

  async function worker(): Promise<void> {
    for (;;) {
      if (stop) return
      if (opts.signal?.aborted) {
        stop = 'interrupted'
        return
      }
      if (overBudget()) {
        stop = 'budget_cap'
        return
      }
      const next = queue.next()
      if (next.done) return
      const hand = next.value
      const key = handKeyOf(hand.groupIndex, hand.rotation)
      const attempt = (progress.attempts.get(key) ?? 0) + 1
      progress.attempts.set(key, attempt)
      let capped = false
      try {
        const result = await playHand({
          config: { ...cashHandConfig(hand, config.format), handId: `${key}#${attempt}` },
          duplicate: { groupIndex: hand.groupIndex, rotation: hand.rotation, order: hand.order, seed: hand.seed, attempt },
          players,
          sink,
          decisionTimeoutMs: config.decisionTimeoutMs,
          stopSpending: () => {
            if (overBudget()) capped = true
            return capped
          },
          ...(opts.now ? { now: opts.now } : {}),
          ...(opts.sleep ? { sleep: opts.sleep } : {}),
        })
        progress.handsPlayed++
        if (!capped) progress.valid.set(key, result.net)
        checkpoint()
      } catch (e) {
        failure ??= e
        stop = 'interrupted'
        return
      }
    }
  }

  await Promise.all(Array.from({ length: config.concurrency }, () => worker()))
  const groupsCompleted = completedPrefix(progress, n, config.maxGroups)
  const reason: StudyEndReason = stop ?? (groupsCompleted >= config.maxGroups ? 'max_groups' : 'interrupted')
  const costUsd = store.gameCost(config.id)
  sink.append({ type: 'study_ended', reason, groupsCompleted, handsPlayed: progress.handsPlayed, costUsd })
  store.setStatus(config.id, reason === 'interrupted' ? 'interrupted' : 'ended')
  if (failure) throw failure
  return { reason, groupsCompleted, summary: summaryNow(), costUsd, configHash: hash }
}
```

`apps/study/src/index.ts`:
```ts
export * from './config'
export * from './stats'
export * from './progress'
export * from './results'
export * from './prereg'
export * from './run'
```


Key points:
- Results only ever use the completed prefix of groups, truncated to whole neighbour blocks.
- `stopSpending` marks a hand as capped; capped hands are not valid and get replayed on resume.
- A finished study (`ci_target` / `max_groups`) returns its summary without playing more.
- The first test is a strong correctness check: five identical deterministic players must break exactly even under duplicate play.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/study exec vitest run && pnpm --filter @ab/study exec tsc --noEmit`
Expected: PASS (15 tests); typecheck clean.

- [ ] **Step 5: Commit**


```bash
git add apps/study/src/progress.ts apps/study/src/results.ts apps/study/src/prereg.ts apps/study/src/run.ts apps/study/src/index.ts apps/study/test/run.test.ts
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(study): duplicate study runner with budget cap, resume and CI stopping rule" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```


---

### Task 5: `pnpm study` CLI and example studies

**Files:**
- Create: `apps/study/src/commands.ts`, `apps/study/src/cli.ts`, `studies/smoke.example.json`, `studies/main.example.json`
- Modify: `apps/study/src/index.ts` (append export), root `package.json` (script)
- Test: `apps/study/test/commands.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/study/test/commands.test.ts`:

```ts
import { EventStore } from '@ab/core'
import { describe, expect, it } from 'vitest'
import { mockVariant, preregCommand, runCommand, statusCommand } from '../src/commands'
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
  bootstrapResamples: 500,
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

  it('runs a mock study and reports status', async () => {
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
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/study exec vitest run test/commands.test.ts`
Expected: FAIL, cannot resolve `../src/commands`.

- [ ] **Step 3: Implement**

`apps/study/src/commands.ts`:

```ts
import { configHash, EventStore } from '@ab/core'
import { adaptLineup, createPlayers, fetchModelCatalog, type PlayerEnv, type PlayerSpec } from '@ab/players'
import { readFileSync } from 'node:fs'
import { parseStudyConfig, type StudyConfig } from './config'
import { preregistration } from './prereg'
import { completedPrefix, readStoreProgress } from './progress'
import { summarize, type StudySummary } from './results'
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
  const lineup = await resolveLineup(c, mock, deps.log)
  const players = createPlayers(lineup, deps.env)
  const prereg = preregistration(c, lineup)
  if (mock) deps.log('mock mode: no API calls are made; costs shown are simulated')
  deps.log(`study ${c.id}: ${players.map((p) => `${p.id}=${p.model}`).join(', ')}`)
  deps.log(`pre-registration hash ${configHash(prereg)}; budget $${c.budgetUsd}; ${c.concurrency} table(s)`)
  const outcome = await runStudy({
    config: c,
    players,
    store,
    prereg,
    ...(deps.signal ? { signal: deps.signal } : {}),
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
  const progress = readStoreProgress(store, c.id)
  const prefix = completedPrefix(progress, c.lineup.length, c.maxGroups)
  deps.log(`study ${c.id}: ${game.status}${progress.lastEnd ? ` (${progress.lastEnd})` : ''}, ${progress.handsPlayed} hands played, hash ${game.configHash.slice(0, 12)}…`)
  formatSummary(summarize(progress, c, prefix), store.gameCost(c.id)).forEach(deps.log)
}
```

`apps/study/src/cli.ts`:

```ts
/**
 * pnpm study prereg <config.json> [--mock]    print the pre-registration record and hash
 * pnpm study run    <config.json> [--mock]    run or resume a study (real runs spend money)
 * pnpm study status <config.json> [--mock]    progress, cost and current bb/100 intervals
 * Options: --db <path> (default data/studies.db). Keys come from .env (see .env.example).
 */
import { EventStore } from '@ab/core'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadStudyConfig, preregCommand, runCommand, statusCommand } from './commands'

const [command, configPath, ...rest] = process.argv.slice(2)
const mock = rest.includes('--mock')
const dbIndex = rest.indexOf('--db')
const dbPath = dbIndex >= 0 ? rest[dbIndex + 1]! : 'data/studies.db'
if (!command || !configPath || !['prereg', 'run', 'status'].includes(command)) {
  console.error('usage: pnpm study <prereg|run|status> <config.json> [--mock] [--db path]')
  process.exit(2)
}
try {
  process.loadEnvFile('.env')
} catch {
  // no .env: fine for --mock and status
}
const config = loadStudyConfig(configPath)
const deps = { env: process.env, log: (line: string) => console.log(line) }

if (command === 'prereg') {
  await preregCommand(config, mock, deps)
} else {
  mkdirSync(dirname(dbPath), { recursive: true })
  const store = new EventStore(dbPath)
  if (command === 'status') {
    statusCommand(config, mock, store, deps)
  } else {
    const ac = new AbortController()
    process.once('SIGINT', () => {
      console.log('stopping after the hands in progress…')
      ac.abort()
    })
    await runCommand(config, mock, store, { ...deps, signal: ac.signal })
  }
  store.close()
}
```

Append to `apps/study/src/index.ts`:
```ts
export * from './commands'
```

In the root `package.json` `scripts`, add:
```json
    "study": "tsx apps/study/src/cli.ts"
```

`studies/smoke.example.json`:

```json
{
  "_note": "Pipeline check with the research line-up: 8 groups (40 hands), about $1. Run with --mock first (free).",
  "id": "smoke-2026-09",
  "lineup": [
    { "id": "jev", "kind": "jev", "model": "jev-1.13.0" },
    { "id": "pill", "kind": "llm", "model": "anthropic/claude-fable-5.1" },
    { "id": "block", "kind": "llm", "model": "openai/gpt-6-astra" },
    { "id": "drip", "kind": "llm", "model": "google/gemini-3.8-flash" },
    { "id": "nimbus", "kind": "llm", "model": "meta-llama/llama-4-maverick" }
  ],
  "masterSeed": "artificialbluff-smoke-2026-09",
  "budgetUsd": 1.5,
  "targetHalfWidthBb100": 1,
  "minGroups": 8,
  "maxGroups": 8,
  "checkEvery": 4,
  "concurrency": 2
}
```

`studies/main.example.json`:

```json
{
  "_note": "Main study. Publish `pnpm study prereg` output before running. targetHalfWidthBb100 is a research choice: set it before pre-registering.",
  "id": "main-2026-09",
  "lineup": [
    { "id": "jev", "kind": "jev", "model": "jev-1.13.0" },
    { "id": "pill", "kind": "llm", "model": "anthropic/claude-fable-5.1" },
    { "id": "block", "kind": "llm", "model": "openai/gpt-6-astra" },
    { "id": "drip", "kind": "llm", "model": "google/gemini-3.8-flash" },
    { "id": "nimbus", "kind": "llm", "model": "meta-llama/llama-4-maverick" }
  ],
  "masterSeed": "artificialbluff-main-2026-09",
  "budgetUsd": 25,
  "targetHalfWidthBb100": 10,
  "minGroups": 40,
  "maxGroups": 2000,
  "checkEvery": 20,
  "concurrency": 2
}
```

- [ ] **Step 4: Run tests, typecheck and a free mock study**

Run: `pnpm --filter @ab/study exec vitest run && pnpm typecheck`
Expected: PASS (19 tests); typecheck clean everywhere.

Run: `pnpm study run studies/smoke.example.json --mock --db data/study-mock.db`
Expected: "mock mode: no API calls…", the pre-registration hash, checkpoint tables, then `ended: ci_target` (identical mock strategies break exactly even, so every CI is 0 wide) with 8 groups. Costs shown are simulated.

- [ ] **Step 5: Full verification and commit**

Run: `pnpm test && pnpm typecheck`
Expected: engine 104, players 44, core 34, study 19; typecheck clean.


```bash
git add apps/study/src/commands.ts apps/study/src/cli.ts apps/study/src/index.ts apps/study/test/commands.test.ts studies/smoke.example.json studies/main.example.json package.json
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(study): pnpm study prereg|run|status with mock mode; example studies" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```


---

## Running the study (user, costs money)

1. Publish the pre-registration: `pnpm study prereg studies/main.json` (copy of `main.example.json` with the final target). Save the JSON and hash somewhere public before running.
2. Free rehearsal: `pnpm study run studies/smoke.json --mock`.
3. Smoke (~$1): `pnpm study run studies/smoke.json`.
4. Main: `pnpm study run studies/main.json`; `pnpm study status studies/main.json` any time; Ctrl-C stops after the hands in flight; re-running resumes. Topping up `budgetUsd` keeps the same pre-registration.

## Done when

- `pnpm test` passes (engine 104, players 44, core 34, study 19); `pnpm typecheck` clean.
- `pnpm study run studies/smoke.example.json --mock` completes for free.
- Next: Plan 3b reads the study's events (and live games') to produce the report: bb/100 with CIs, cost, latency, calibration (A: main-pot share; C: expected main-pot share at decision), fallback rates, play style, CSV/JSON exports and a static HTML report.

