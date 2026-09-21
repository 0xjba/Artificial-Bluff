# artificialBluff Plan 3a: Study Runner

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the pre-registered duplicate study: seed groups with neighbour-balanced seating, played by the real players (or free mocks), with a budget cap checked before every hand and decision, crash/budget-safe resume, and a CI-based stopping rule over whole neighbour blocks. Ships `pnpm study prereg|run|status`.

**Architecture:** A new package `apps/study` (`@ab/study`). `parseStudyConfig` validates a JSON study file. `preregistration` builds the record hashed into the study's game config before hand 1 (everything that affects results; not budget or concurrency, so a study can be topped up and resumed). `runStudy` plays hands in group order with N workers through `playHand`, tags each hand with its place in the duplicate schedule, and after every completed hand checks the stopping rule (95% Student t CIs of bb/100) over the **completed prefix** of groups in whole neighbour blocks (no cherry-picking), logging each check. Hands cut short by the budget cap are excluded and replayed as a new attempt on resume. Small core additions: `DuplicateInfo` on `hand_started`, and `study_checkpoint` / `study_ended` events.

**Tech Stack:** as Plans 1–2 (TypeScript strict, Vitest, better-sqlite3 via `@ab/core`, `tsx` for the CLI).

**Spec:** `docs/superpowers/specs/2026-09-21-artificialbluff-design.md` §4 (duplicate + neighbour blocks), §6 (study runner, pre-registration, budget, resume, stopping). Status/todos: `docs/STATUS.md`.

**Plan series:** 1 Engine (merged) → 2 Players, runner, event log (merged) → **3a Study runner (this)** → 3b Analysis and report (bb/100, cost, latency, calibration A and C, play style, exports, HTML) → 4 Live server and web.

---

## Notes for the implementer

- **Duplicate:** each seed group plays one deck once per seat rotation (5 hands for 5 players) on a base seating that varies by group; every block of 4 groups balances who sits next to whom (`neighbourBlockSize`). Results use whole blocks only.
- **Hand ids:** `"<group>:<rotation>#<attempt>"`. A hand is valid if it reached `hand_ended` and no decision in it was auto-played because the budget cap was hit (`fallbackReason === 'auto: budget cap reached'`). Invalid attempts are simply superseded by the next attempt on resume; nothing is deleted.
- **Stopping rule:** every `checkEvery` completed groups, over the completed prefix (groups 0..k-1 all valid), truncated to whole blocks: stop when every player's 95% **Student t** CI (df = blocks − 1) half-width of bb/100 is ≤ target; never before `minGroups`, which must be ≥ 10 neighbour blocks (40 groups for 5 players) unless the study has a fixed size (`minGroups == maxGroups`); at most `maxGroups`. Every check is logged as a `study_checkpoint` event.
- **Check schedule is data-only:** the rule is evaluated at every boundary (each multiple of `checkEvery`, plus `maxGroups`) in order, over exactly the groups before that boundary, and the first met boundary ends the study; results (and `study_ended.analysedGroups`) use that boundary, not hands that finished later. Resume continues after the last logged check (catching up on any a crash skipped); a met check that never reached `study_ended` still ends the study. A met rule wins over a budget cap or interruption. So the stopping point depends neither on concurrency nor on where a run was interrupted (review finding).
- **One runner per study:** `EventStore.claimGame` atomically refuses a study already marked `running`; `--takeover` resumes one a crash left running. Progress is read only after the claim (a stale read could replay hands another run just finished). `minGroups` must be a multiple of `checkEvery` (unless fixed size), so a check falls exactly on it.
- **Budget cap:** checked before every hand and decision; with N tables up to N decisions already in flight can finish past it, and a call abandoned on timeout can still be billed, so it is a cap with small, bounded overshoot (logged at start).
- **Why t, not a bootstrap:** a statistics review (fat-tailed simulations) found the percentile bootstrap covers only ~84–90% at 5–10 blocks and, with width-based stopping, published "95%" CIs could cover ~70%. Student t over blocks stays near 95%. The bootstrap is kept as a reported sensitivity check.
- **bb/100:** per group, a player's net over all rotations ÷ rotations ÷ big blind × 100 (each player plays one hand per rotation); block value = mean of its groups; the t CI and the bootstrap both work on block values.
- **Pre-registration:** `configHash(preregistration(...))` is stored as the study game's config hash. Resuming with a different record is refused. Budget and concurrency are deliberately not in it.
- **Money:** never run `pnpm study run` without `--mock` unless the user explicitly says so. `--mock` swaps paid seats for free mocks under `<id>-mock`.

## File map

| File | Responsibility |
|---|---|
| `packages/core/src/events.ts` (modify) | `DuplicateInfo` on `hand_started`; `StudyEndReason`; `study_checkpoint` and `study_ended` events |
| `packages/core/src/runner.ts` (modify) | `playHand({ duplicate })` records it on `hand_started` |
| `apps/study/src/config.ts` | `StudyConfig`, `parseStudyConfig` |
| `apps/study/src/stats.ts` | Student t CIs (stopping + published), `bootstrapMean` (sensitivity check) |
| `apps/study/src/progress.ts` | Rebuild progress from events (resume); completed prefix |
| `apps/study/src/results.ts` | bb/100 per player: t CI over neighbour blocks, plus bootstrap sensitivity CI |
| `apps/study/src/prereg.ts` | The pre-registration record |
| `apps/study/src/run.ts` | `runStudy` |
| `apps/study/src/commands.ts`, `cli.ts` | `pnpm study prereg|run|status [--mock]` |
| `studies/*.example.json` | Smoke and main study configs |

---

### Task 1: Study hands in the core event stream

**Files:**
- Modify: `packages/core/src/events.ts`, `packages/core/src/runner.ts`, `packages/core/src/store.ts`
- Test: `packages/core/test/runner.test.ts`, `packages/core/test/store.test.ts`

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

In `packages/core/test/store.test.ts`, add immediately before `it('persists to a file', ...)`:
```ts
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

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/core exec vitest run test/runner.test.ts test/store.test.ts`
Expected: FAIL (`duplicate` missing from `hand_started`; `claimGame` is not a function).

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
and add two new members to `EventBody` after the `game_ended` member:
```ts
  | {
      type: 'study_checkpoint'
      /**
       * The check's boundary: groups 0..groups-1 (a multiple of checkEvery, or maxGroups). Checks run at
       * every boundary in order, whatever the concurrency or resumes, and each is logged once.
       */
      groups: number
      blocks: number
      costUsd: number
      /** 95% Student t CI of bb/100 per player; null where not yet defined (fewer than 2 blocks). */
      players: Array<{ playerId: string; bb100: number | null; low: number | null; high: number | null; halfWidth: number | null }>
      /** Whether the stopping rule was met here (it then ends the study, even after a budget cap). */
      stop: boolean
    }
  | {
      type: 'study_ended'
      reason: StudyEndReason
      /** Seed groups completed in order from group 0. */
      groupsCompleted: number
      /**
       * Groups the results use: the stopping boundary for 'ci_target' (hands still in flight when
       * the rule was met are not included), otherwise groupsCompleted cut to whole neighbour blocks.
       */
      analysedGroups: number
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

In `packages/core/src/store.ts`, add to `EventStore` immediately before the `interruptRunningGames` doc comment (so two processes can never run one study at once):
```ts
  /**
   * Atomically marks an existing game 'running', so two processes can't run it at once. Refuses a
   * game that is already 'running' (another process has it, or a crash left it so) unless `takeover`.
   */
  claimGame(id: string, takeover = false): void {
    this.db
      .transaction(() => {
        const row = this.db.prepare('SELECT status FROM games WHERE id = ?').get(id) as { status: GameStatus } | undefined
        if (!row) throw new Error(`no game ${id}`)
        if (row.status === 'running' && !takeover) {
          throw new Error(`game ${id} is already running (another process, or a crash left it so); if no other run is active, take it over`)
        }
        this.db.prepare("UPDATE games SET status = 'running', ended_at = NULL WHERE id = ?").run(id)
      })
      .immediate()
  }
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/core exec vitest run && pnpm --filter @ab/core exec tsc --noEmit`
Expected: PASS (35 tests); typecheck clean.

- [ ] **Step 5: Commit**


```bash
git add packages/core/src packages/core/test
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(core): duplicate info on study hands; study events; claimGame" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
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
const base = { id: 'pilot', lineup, masterSeed: 'm', budgetUsd: 5, targetHalfWidthBb100: 10, minGroups: 40, maxGroups: 200 }

describe('parseStudyConfig', () => {
  it('fills defaults and ignores _-prefixed notes', () => {
    expect(parseStudyConfig({ ...base, _note: 'hello' })).toEqual({
      ...base,
      format: { smallBlind: 50, bigBlind: 100, stackInBigBlinds: 100 },
      decisionTimeoutMs: 20_000,
      checkEvery: 20,
      concurrency: 2,
      bootstrapResamples: 2000,
    })
  })

  it('rejects unknown keys, so typos cannot silently fall back to defaults', () => {
    expect(() => parseStudyConfig({ ...base, checkevery: 4 })).toThrow(/unknown key\(s\): checkevery/)
    expect(() => parseStudyConfig({ ...base, format: { smallBlind: 50, bigBlind: 100, stackInBigBlinds: 100, ante: 10 } })).toThrow(/unknown format key/)
  })

  it('requires group counts in whole neighbour blocks (4 for 5 players)', () => {
    expect(() => parseStudyConfig({ ...base, minGroups: 42 })).toThrow(/multiple of the neighbour block \(4 for 5 players\)/)
    expect(() => parseStudyConfig({ ...base, checkEvery: 10 })).toThrow(/checkEvery/)
    expect(() => parseStudyConfig({ ...base, minGroups: 44, maxGroups: 40 })).toThrow(/cannot exceed/)
  })

  it('requires at least 10 blocks before the CI rule may stop, unless the study has a fixed size', () => {
    expect(() => parseStudyConfig({ ...base, minGroups: 8 })).toThrow(/at least 10 neighbour blocks \(40 groups for 5 players\)/)
    expect(parseStudyConfig({ ...base, minGroups: 8, maxGroups: 8 }).minGroups).toBe(8)
    expect(() => parseStudyConfig({ ...base, minGroups: 40, checkEvery: 12 })).toThrow(/multiple of "checkEvery"/)
  })

  it('validates every line-up seat', () => {
    const seat = (s: Record<string, unknown>) => ({ ...base, lineup: [...lineup.slice(0, 4), s] })
    expect(() => parseStudyConfig(seat({ id: 'x', kind: 'banana' }))).toThrow(/kind must be/)
    expect(() => parseStudyConfig(seat({ id: 'x', kind: 'llm' }))).toThrow(/model is required/)
    expect(() => parseStudyConfig(seat({ id: 'x', kind: 'bot', bot: 'calling_station' }))).toThrow(/bot must be/)
    expect(() => parseStudyConfig(seat({ id: '', kind: 'mock' }))).toThrow(/simple name/)
    expect(() => parseStudyConfig(seat({ id: 'x', kind: 'llm', model: 'm', reasoning: 'high' }))).toThrow(/reasoning/)
    // Unknown seat keys are dropped rather than pre-registered.
    expect(parseStudyConfig(seat({ id: 'x', kind: 'llm', model: 'm', color: 'red' })).lineup[4]).toEqual({ id: 'x', kind: 'llm', model: 'm' })
    expect(() => parseStudyConfig({ ...base, lineup: Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, kind: 'mock' })) })).toThrow(/2 to 10 players/)
  })

  it('validates the format and other values', () => {
    expect(() => parseStudyConfig({ ...base, format: { smallBlind: 100, bigBlind: 50, stackInBigBlinds: 100 } })).toThrow(/multiple of "format.smallBlind"/)
    expect(() => parseStudyConfig({ ...base, id: 'no spaces allowed' })).toThrow(/id/)
    expect(() => parseStudyConfig({ ...base, budgetUsd: 0 })).toThrow(/budgetUsd/)
    expect(() => parseStudyConfig({ ...base, budgetUsd: Number.NaN })).toThrow(/budgetUsd/)
    expect(() => parseStudyConfig({ ...base, lineup: [lineup[0], lineup[0]] })).toThrow(/unique/)
    expect(() => parseStudyConfig({ ...base, concurrency: 50 })).toThrow(/concurrency/)
    expect(() => parseStudyConfig({ ...base, bootstrapResamples: 200 })).toThrow(/bootstrapResamples/)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @ab/study exec vitest run`
Expected: FAIL, cannot resolve `../src/config`.

- [ ] **Step 4: Implement**

`apps/study/src/config.ts`:

```ts
import { MAX_PLAYERS, neighbourBlockSize, STUDY_CASH, type CashFormat } from '@ab/engine'
import type { PlayerSpec } from '@ab/players'

/** A study, as written in a JSON file. Everything here except budget and concurrency is pre-registered. */
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
  /**
   * Spending cap (USD), checked before every hand and every decision. With several tables, decisions
   * already in flight when it is reached still finish (at most `concurrency` of them), and a call the
   * runner gave up on (timeout) may still be billed, so leave some headroom.
   */
  budgetUsd: number
  /** Stop when every player's 95% t CI half-width for bb/100 is at most this. */
  targetHalfWidthBb100: number
  /**
   * Never stop on the CI before this many groups. Must be at least 10 neighbour blocks (40 groups
   * for 5 players), unless the study has a fixed size (minGroups == maxGroups), and a multiple of
   * checkEvery, so the first check allowed to stop is exactly at minGroups.
   */
  minGroups: number
  /** Stop after this many groups (a multiple of the neighbour block). */
  maxGroups: number
  /** Check the stopping rule every this many completed groups (a multiple of the neighbour block). */
  checkEvery: number
  /** Hands played at once. */
  concurrency: number
  /** Bootstrap resamples for the sensitivity-check CIs. */
  bootstrapResamples: number
}

/** Minimum number of neighbour blocks before the CI stopping rule may fire. */
export const MIN_BLOCKS_BEFORE_STOPPING = 10

const KEYS = new Set([
  'id', 'lineup', 'masterSeed', 'format', 'decisionTimeoutMs', 'budgetUsd', 'targetHalfWidthBb100',
  'minGroups', 'maxGroups', 'checkEvery', 'concurrency', 'bootstrapResamples',
])
const NAME = /^[a-z0-9][a-z0-9._-]*$/i

type Raw = Record<string, unknown>

function num(raw: Raw, key: string, fallback?: number): number {
  const v = raw[key] ?? fallback
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`study config: "${key}" must be a finite number`)
  return v
}

function int(raw: Raw, key: string, min: number, fallback?: number, max = Number.MAX_SAFE_INTEGER): number {
  const v = num(raw, key, fallback)
  if (!Number.isInteger(v) || v < min || v > max) throw new Error(`study config: "${key}" must be an integer from ${min} to ${max}`)
  return v
}

/** Validates one line-up seat and returns it with only its known fields. */
function parseSeat(raw: unknown, index: number): PlayerSpec {
  const where = `lineup[${index}]`
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`study config: ${where} must be an object`)
  const s = raw as Raw
  if (typeof s.id !== 'string' || !NAME.test(s.id)) throw new Error(`study config: ${where}.id must be a simple name`)
  const model = () => {
    if (typeof s.model !== 'string' || s.model.trim() === '') throw new Error(`study config: ${where}.model is required for kind "${String(s.kind)}"`)
    return s.model
  }
  switch (s.kind) {
    case 'jev':
      return { id: s.id, kind: 'jev', model: model() }
    case 'llm': {
      const seat: PlayerSpec = { id: s.id, kind: 'llm', model: model() }
      if (s.reasoning !== undefined) {
        if (s.reasoning !== 'off' && s.reasoning !== 'low' && s.reasoning !== 'omit') throw new Error(`study config: ${where}.reasoning must be "off", "low" or "omit"`)
        seat.reasoning = s.reasoning
      }
      for (const flag of ['structuredOutput', 'sendTemperature'] as const) {
        if (s[flag] !== undefined) {
          if (typeof s[flag] !== 'boolean') throw new Error(`study config: ${where}.${flag} must be true or false`)
          seat[flag] = s[flag]
        }
      }
      return seat
    }
    case 'bot': {
      if (s.bot !== 'random' && s.bot !== 'calling-station' && s.bot !== 'tag') throw new Error(`study config: ${where}.bot must be "random", "calling-station" or "tag"`)
      if (s.seed !== undefined && !Number.isInteger(s.seed)) throw new Error(`study config: ${where}.seed must be an integer`)
      return { id: s.id, kind: 'bot', bot: s.bot, ...(s.seed !== undefined ? { seed: s.seed as number } : {}) }
    }
    case 'mock': {
      if (s.model !== undefined && (typeof s.model !== 'string' || s.model === '')) throw new Error(`study config: ${where}.model must be a non-empty string`)
      const price = s.inputPricePerMTok
      if (price !== undefined && (typeof price !== 'number' || !Number.isFinite(price) || price < 0)) throw new Error(`study config: ${where}.inputPricePerMTok must be ≥ 0`)
      return { id: s.id, kind: 'mock', ...(s.model !== undefined ? { model: s.model as string } : {}), ...(price !== undefined ? { inputPricePerMTok: price as number } : {}) }
    }
    default:
      throw new Error(`study config: ${where}.kind must be "jev", "llm", "bot" or "mock"`)
  }
}

function parseFormat(raw: unknown): CashFormat {
  if (raw === undefined) return { ...STUDY_CASH }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('study config: "format" must be an object')
  const f = raw as Raw
  const extra = Object.keys(f).filter((k) => !['smallBlind', 'bigBlind', 'stackInBigBlinds'].includes(k))
  if (extra.length) throw new Error(`study config: unknown format key(s): ${extra.join(', ')}`)
  const format = {
    smallBlind: int(f, 'smallBlind', 1),
    bigBlind: int(f, 'bigBlind', 1),
    stackInBigBlinds: int(f, 'stackInBigBlinds', 1),
  }
  if (format.smallBlind > format.bigBlind || format.bigBlind % format.smallBlind !== 0) {
    throw new Error('study config: "format.bigBlind" must be a multiple of "format.smallBlind"')
  }
  return format
}

/**
 * Parses and validates a study config (from JSON), filling defaults. Unknown keys are errors (keys
 * starting with "_", e.g. "_note", are ignored and not pre-registered), so a typo can't silently
 * fall back to a default that then gets pre-registered.
 */
export function parseStudyConfig(input: unknown): StudyConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('study config must be a JSON object')
  const raw = input as Raw
  const unknown = Object.keys(raw).filter((k) => !k.startsWith('_') && !KEYS.has(k))
  if (unknown.length) throw new Error(`study config: unknown key(s): ${unknown.join(', ')}`)
  if (typeof raw.id !== 'string' || !NAME.test(raw.id)) throw new Error('study config: "id" must be a simple name')
  if (typeof raw.masterSeed !== 'string' || raw.masterSeed === '') throw new Error('study config: "masterSeed" must be a non-empty string')
  if (!Array.isArray(raw.lineup) || raw.lineup.length < 2 || raw.lineup.length > MAX_PLAYERS) {
    throw new Error(`study config: "lineup" needs 2 to ${MAX_PLAYERS} players`)
  }
  const lineup = raw.lineup.map(parseSeat)
  if (new Set(lineup.map((p) => p.id)).size !== lineup.length) throw new Error('study config: lineup ids must be unique')

  const block = neighbourBlockSize(lineup.length)
  const config: StudyConfig = {
    id: raw.id,
    lineup,
    masterSeed: raw.masterSeed,
    format: parseFormat(raw.format),
    decisionTimeoutMs: int(raw, 'decisionTimeoutMs', 1000, 20_000, 300_000),
    budgetUsd: num(raw, 'budgetUsd'),
    targetHalfWidthBb100: num(raw, 'targetHalfWidthBb100'),
    minGroups: int(raw, 'minGroups', block),
    maxGroups: int(raw, 'maxGroups', block),
    checkEvery: int(raw, 'checkEvery', block, 20),
    concurrency: int(raw, 'concurrency', 1, 2, 16),
    bootstrapResamples: int(raw, 'bootstrapResamples', 1000, 2000),
  }
  if (config.budgetUsd <= 0) throw new Error('study config: "budgetUsd" must be positive')
  if (config.targetHalfWidthBb100 <= 0) throw new Error('study config: "targetHalfWidthBb100" must be positive')
  for (const k of ['minGroups', 'maxGroups', 'checkEvery'] as const) {
    if (config[k] % block !== 0) throw new Error(`study config: "${k}" must be a multiple of the neighbour block (${block} for ${lineup.length} players)`)
  }
  if (config.minGroups > config.maxGroups) throw new Error('study config: "minGroups" cannot exceed "maxGroups"')
  if (config.minGroups < MIN_BLOCKS_BEFORE_STOPPING * block && config.minGroups !== config.maxGroups) {
    throw new Error(
      `study config: "minGroups" must be at least ${MIN_BLOCKS_BEFORE_STOPPING} neighbour blocks ` +
        `(${MIN_BLOCKS_BEFORE_STOPPING * block} groups for ${lineup.length} players) so the CI stopping rule can't fire on too little data, ` +
        'unless the study has a fixed size (minGroups == maxGroups)',
    )
  }
  if (config.minGroups !== config.maxGroups && config.minGroups % config.checkEvery !== 0) {
    throw new Error('study config: "minGroups" must be a multiple of "checkEvery" (so a check falls exactly on it)')
  }
  return config
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @ab/study exec vitest run && pnpm --filter @ab/study exec tsc --noEmit`
Expected: PASS (6 tests); typecheck clean.

- [ ] **Step 6: Commit**


```bash
git add apps/study/package.json apps/study/tsconfig.json apps/study/src/config.ts apps/study/test/config.test.ts pnpm-lock.yaml
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(study): study package and validated study config" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```


---

### Task 3: Confidence intervals (Student t; bootstrap as a sensitivity check)

**Files:**
- Create: `apps/study/src/stats.ts`
- Test: `apps/study/test/stats.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/study/test/stats.test.ts`:

```ts
import { deriveSeed, mulberry32 } from '@ab/engine'
import { describe, expect, it } from 'vitest'
import { bootstrapMean, studentTQuantile, tInterval } from '../src/stats'

/** Student t with 3 df (fat-tailed, like poker results). */
function t3(rand: () => number): number {
  const normal = () => {
    const u = Math.max(rand(), 1e-12)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
  }
  const z = normal()
  const chi = normal() ** 2 + normal() ** 2 + normal() ** 2
  return z / Math.sqrt(chi / 3)
}

describe('studentTQuantile', () => {
  it('matches published t tables', () => {
    expect(studentTQuantile(0.975, 1)).toBeCloseTo(12.7062, 3)
    expect(studentTQuantile(0.975, 4)).toBeCloseTo(2.776445, 5)
    expect(studentTQuantile(0.975, 9)).toBeCloseTo(2.262157, 5)
    expect(studentTQuantile(0.975, 29)).toBeCloseTo(2.04523, 5)
    expect(studentTQuantile(0.975, 1000)).toBeCloseTo(1.962339, 4)
    expect(studentTQuantile(0.5, 7)).toBeCloseTo(0, 6)
  })
})

describe('tInterval', () => {
  it('computes mean ± t × standard error', () => {
    const ci = tInterval([1, 2, 3, 4, 5])
    // sd = 1.5811, se = 0.7071, t(0.975, 4) = 2.7764
    expect(ci.mean).toBe(3)
    expect(ci.halfWidth).toBeCloseTo(2.776445 * 0.707107, 4)
    expect(ci.low).toBeCloseTo(3 - ci.halfWidth, 10)
  })

  it('keeps about 95% coverage at 10 fat-tailed blocks (the regime a study stops in)', () => {
    let covered = 0
    for (let trial = 0; trial < 2000; trial++) {
      const rand = mulberry32(deriveSeed('cov-t', trial))
      const blocks = Array.from({ length: 10 }, () => t3(rand))
      const ci = tInterval(blocks)
      if (ci.low <= 0 && 0 <= ci.high) covered++
    }
    expect(covered / 2000).toBeGreaterThan(0.93)
  })

  it('is zero-width for identical values and infinite with fewer than two', () => {
    expect(tInterval([2, 2, 2]).halfWidth).toBe(0)
    expect(tInterval([3]).halfWidth).toBe(Number.POSITIVE_INFINITY)
  })

  it('rejects non-finite values', () => {
    expect(() => tInterval([1, Number.NaN])).toThrow(/finite/)
  })
})

describe('bootstrapMean (sensitivity check only)', () => {
  it('is deterministic for a seed, brackets the mean, and uses symmetric tails', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const a = bootstrapMean(values, 2000, 's')
    expect(bootstrapMean(values, 2000, 's')).toEqual(a)
    expect(a.mean).toBe(5.5)
    expect(a.low).toBeLessThan(5.5)
    expect(a.high).toBeGreaterThan(5.5)
  })

  it('undercovers at 10 fat-tailed blocks, which is why the study uses t', () => {
    let covered = 0
    for (let trial = 0; trial < 500; trial++) {
      const rand = mulberry32(deriveSeed('cov-b', trial))
      const blocks = Array.from({ length: 10 }, () => t3(rand))
      const ci = bootstrapMean(blocks, 1000, `b${trial}`)
      if (ci.low <= 0 && 0 <= ci.high) covered++
    }
    expect(covered / 500).toBeLessThan(0.93)
  })

  it('validates its inputs', () => {
    expect(() => bootstrapMean([1, 2], 10, 's')).toThrow(/resamples/)
    expect(() => bootstrapMean([1, 2], 1000, 's', 1.5)).toThrow(/level/)
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

const INFINITE = (mean: number): Interval => ({
  mean,
  low: Number.NEGATIVE_INFINITY,
  high: Number.POSITIVE_INFINITY,
  halfWidth: Number.POSITIVE_INFINITY,
})

function checkInputs(values: readonly number[], level: number): void {
  if (!(level > 0 && level < 1)) throw new Error('level must be between 0 and 1')
  if (values.some((v) => !Number.isFinite(v))) throw new Error('values must be finite numbers')
}

/** log Γ(x) (Lanczos approximation). */
function logGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]
  let y = x
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5)
  let ser = 1.000000000190015
  for (const k of c) ser += k / ++y
  return -tmp + Math.log((2.5066282746310005 * ser) / x)
}

/** Continued fraction for the incomplete beta function (Numerical Recipes betacf). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300
  let c = 1
  let d = 1 - ((a + b) * x) / (a + 1)
  if (Math.abs(d) < tiny) d = tiny
  d = 1 / d
  let h = d
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < 1e-14) break
  }
  return h
}

/** Regularized incomplete beta I_x(a, b). */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2) ? (front * betaContinuedFraction(a, b, x)) / a : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b
}

/** Student t CDF with `df` degrees of freedom. */
export function studentTCdf(t: number, df: number): number {
  const tail = 0.5 * incompleteBeta(df / (df + t * t), df / 2, 0.5)
  return t >= 0 ? 1 - tail : tail
}

/** Student t quantile (inverse CDF) by bisection; accurate to ~1e-10. */
export function studentTQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1)) throw new Error('p must be between 0 and 1')
  if (!(df > 0)) throw new Error('df must be positive')
  let lo = -1e4
  let hi = 1e4
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (studentTCdf(mid, df) < p) lo = mid
    else hi = mid
    if (hi - lo < 1e-12) break
  }
  return (lo + hi) / 2
}

/**
 * Mean with a Student t CI (df = n - 1). Used for the stopping rule and the published CIs: it keeps
 * close to nominal coverage at the small block counts a study stops at, where percentile bootstraps
 * are too narrow.
 */
export function tInterval(values: readonly number[], level = 0.95): Interval {
  checkInputs(values, level)
  const n = values.length
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : Number.NaN
  if (n < 2) return INFINITE(mean)
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)
  const halfWidth = studentTQuantile(1 - (1 - level) / 2, n - 1) * Math.sqrt(variance / n)
  return { mean, low: mean - halfWidth, high: mean + halfWidth, halfWidth }
}

/**
 * Mean of `values` with a percentile bootstrap CI (resampling the values with replacement).
 * Reported as a sensitivity check only: it undercovers at small counts.
 */
export function bootstrapMean(values: readonly number[], resamples: number, seed: string, level = 0.95): Interval {
  checkInputs(values, level)
  if (!Number.isInteger(resamples) || resamples < 100) throw new Error('resamples must be an integer ≥ 100')
  const n = values.length
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : Number.NaN
  if (n < 2) return INFINITE(mean)
  const rand = mulberry32(deriveSeed('bootstrap', seed))
  const means = new Array<number>(resamples)
  for (let r = 0; r < resamples; r++) {
    let sum = 0
    for (let i = 0; i < n; i++) sum += values[Math.floor(rand() * n)]!
    means[r] = sum / n
  }
  means.sort((a, b) => a - b)
  // Symmetric order statistics: k from each end.
  const k = Math.max(1, Math.floor((resamples + 1) * ((1 - level) / 2) + 1e-9))
  const low = means[k - 1]!
  const high = means[resamples - k]!
  return { mean, low, high, halfWidth: (high - low) / 2 }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @ab/study exec vitest run`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**


```bash
git add apps/study/src/stats.ts apps/study/test/stats.test.ts
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(study): Student t and bootstrap CIs" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```


---

### Task 4: Study runner (progress, results, pre-registration, run)

**Files:**
- Create: `apps/study/src/progress.ts`, `apps/study/src/results.ts`, `apps/study/src/prereg.ts`, `apps/study/src/run.ts`, `apps/study/src/index.ts`
- Test: `apps/study/test/run.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/study/test/run.test.ts` (all free: bots and mocks):

```ts
import { EventStore, type EventBody, type GameEvent } from '@ab/core'
import { CallingStation, MockLlm, RandomBot, TagBot, type Player } from '@ab/players'
import { describe, expect, it } from 'vitest'
import { parseStudyConfig, type StudyConfig } from '../src/config'
import { preregistration } from '../src/prereg'
import { BUDGET_CAP_REASON, emptyProgress, handKeyOf, readProgress, readStoreProgress } from '../src/progress'
import { summarize } from '../src/results'
import { runStudy } from '../src/run'

const ids = ['jev', 'pill', 'block', 'drip', 'nimbus']

function config(over: Record<string, unknown> = {}): StudyConfig {
  return parseStudyConfig({
    id: 'pilot',
    lineup: ids.map((id) => ({ id, kind: 'mock' })),
    masterSeed: 'm',
    budgetUsd: 100,
    targetHalfWidthBb100: 1000,
    // Fixed size (min == max) unless a test overrides: the CI rule then only fires at the end.
    minGroups: 16,
    maxGroups: 16,
    checkEvery: 4,
    concurrency: 1,
    bootstrapResamples: 1000,
    decisionTimeoutMs: 1000,
    ...over,
  })
}

const run = (c: StudyConfig, players: Player[], store: EventStore, signal?: AbortSignal, takeover?: boolean) =>
  runStudy({ config: c, players, store, prereg: preregistration(c, c.lineup), ...(signal ? { signal } : {}), ...(takeover ? { takeover } : {}) })

const tags = () => ids.map((id) => new TagBot(id))
const mixed = () => [new TagBot('jev'), new CallingStation('pill'), new MockLlm('block'), new TagBot('drip'), new CallingStation('nimbus')]

type Of<T extends GameEvent['type']> = Extract<GameEvent, { type: T }>
const eventsOf = <T extends GameEvent['type']>(store: EventStore, type: T) => store.events('pilot').filter((e): e is Of<T> => e.type === type)
const checks = (store: EventStore) => eventsOf(store, 'study_checkpoint').map((c) => [c.groups, c.stop])

/** Calls `trip` on the player's `after`-th decision (to interrupt a run mid-way). */
function tripwire(p: Player, after: number, trip: () => void): Player {
  let calls = 0
  return { id: p.id, kind: p.kind, model: p.model, decide: (obs, signal) => (++calls === after && trip(), p.decide(obs, signal)) }
}

/** Answers after a varying delay (deterministic), so parallel tables finish out of order. */
function jitter(p: Player): Player {
  let calls = 0
  return {
    id: p.id,
    kind: p.kind,
    model: p.model,
    decide: async (obs, signal) => {
      await new Promise((r) => setTimeout(r, (++calls * 7) % 5))
      return p.decide(obs, signal)
    },
  }
}

/** Copies a study's events, minus those `drop` rejects, into a new store left 'running' (a crash). */
function crashCopy(from: EventStore, drop: (e: GameEvent, i: number, all: GameEvent[]) => boolean): EventStore {
  const to = new EventStore()
  to.createGame('pilot', 'study', from.game('pilot')!.config)
  const all = from.events('pilot')
  all.forEach((e, i) => {
    if (drop(e, i, all)) return
    const { gameId: _g, seq: _s, ts: _t, ...body } = e
    to.append('pilot', body as EventBody)
  })
  return to
}

describe('runStudy', () => {
  it('duplicate play cancels luck: identical players break exactly even', async () => {
    const store = new EventStore()
    const out = await run(config({ targetHalfWidthBb100: 0.001 }), tags(), store)
    expect(out.reason).toBe('ci_target') // every CI is exactly [0, 0]
    expect(out.groupsCompleted).toBe(16)
    for (const p of out.summary.players) expect(p.bb100).toMatchObject({ mean: 0, halfWidth: 0 })
  })

  it('never stops on the CI before minGroups, and logs every check', async () => {
    const store = new EventStore()
    const out = await run(config({ minGroups: 40, maxGroups: 80, checkEvery: 20, targetHalfWidthBb100: 0.001 }), tags(), store)
    expect(out.reason).toBe('ci_target')
    expect(out.groupsCompleted).toBe(40) // CI was already 0-wide at 20 groups, but 40 is the minimum
    const checks = store.events('pilot').filter((e): e is Extract<GameEvent, { type: 'study_checkpoint' }> => e.type === 'study_checkpoint')
    expect(checks.map((c) => [c.groups, c.stop])).toEqual([
      [20, false],
      [40, true],
    ])
    expect(checks[1]!.players[0]).toMatchObject({ playerId: 'jev', bb100: 0, halfWidth: 0 })
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
    expect(last).toMatchObject({ type: 'study_ended', reason: 'max_groups', groupsCompleted: 16, analysedGroups: 16, handsPlayed: 80 })
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

  it('checks the stopping rule at the same boundaries whatever the concurrency', async () => {
    const c = { minGroups: 40, maxGroups: 80, checkEvery: 8, targetHalfWidthBb100: 0.001 }
    const one = new EventStore()
    const many = new EventStore()
    const a = await run(config({ ...c, concurrency: 1 }), mixed(), one)
    const b = await run(config({ ...c, concurrency: 16 }), mixed().map(jitter), many)
    expect(checks(one)).toEqual(Array.from({ length: 10 }, (_, i) => [8 * (i + 1), false]))
    expect(checks(many)).toEqual(checks(one))
    expect(b.reason).toBe(a.reason)
    expect(b.summary).toEqual(a.summary)
  })

  it('resumes the check schedule where it left off', async () => {
    const store = new EventStore()
    const ac = new AbortController()
    const players = tags().map((p, i) => (i === 0 ? tripwire(p, 28, () => ac.abort()) : p))
    const c = config({ checkEvery: 8 })
    const first = await run(c, players, store, ac.signal)
    expect(first.reason).toBe('interrupted')
    expect(first.groupsCompleted).toBeGreaterThan(4) // past a block, short of the first check at 8
    expect(first.groupsCompleted).toBeLessThan(8)
    const second = await run(c, tags(), store)
    expect(second.reason).toBe('ci_target')
    expect(checks(store)).toEqual([[8, false], [16, true]])
  })

  it('ends a study whose stopping rule was met before a crash, without playing on', async () => {
    const done = new EventStore()
    await run(config({ targetHalfWidthBb100: 0.001 }), tags(), done)
    // Crash after the met check was logged, before study_ended.
    const crashed = crashCopy(done, (e) => e.type === 'study_ended')
    await expect(run(config({ targetHalfWidthBb100: 0.001 }), tags(), crashed)).rejects.toThrow(/already running/)
    const hands = eventsOf(crashed, 'hand_started').length
    const out = await run(config({ targetHalfWidthBb100: 0.001 }), tags(), crashed, undefined, true)
    expect(out.reason).toBe('ci_target')
    expect(eventsOf(crashed, 'hand_started')).toHaveLength(hands)
    expect(crashed.events('pilot').at(-1)).toMatchObject({ type: 'study_ended', reason: 'ci_target', analysedGroups: 16 })
    const rerun = await run(config({ targetHalfWidthBb100: 0.001 }), tags(), crashed) // finished: reads, plays nothing
    expect(rerun).toMatchObject({ reason: 'ci_target', summary: { groups: 16 } })
    expect(crashed.game('pilot')!.status).toBe('ended')
    // Crash after the last hand, before its check was logged: the check is caught up on resume.
    const early = crashCopy(done, (e, i, all) => e.type === 'study_ended' || (e.type === 'study_checkpoint' && i === all.length - 2))
    const again = await run(config({ targetHalfWidthBb100: 0.001 }), tags(), early, undefined, true)
    expect(again.reason).toBe('ci_target')
    expect(checks(early)).toEqual([[4, false], [8, false], [12, false], [16, true]])
  })

  it('refuses a pre-registration made for a different config', async () => {
    const c = config()
    await expect(runStudy({ config: c, players: tags(), store: new EventStore(), prereg: preregistration(config({ minGroups: 8, maxGroups: 8 }), c.lineup) })).rejects.toThrow(/not for study config/)
    expect(() => preregistration(c, c.lineup, { study: {} })).toThrow(/overwrite/)
  })

  it('deals every rotation of a group the same cards, and seats each player once in each seat', async () => {
    const store = new EventStore()
    await run(config({ maxGroups: 4, minGroups: 4 }), tags(), store)
    const starts = eventsOf(store, 'hand_started')
    const dealt = new Map(eventsOf(store, 'cards_dealt').map((e) => [e.handId, e.holes]))
    for (let g = 0; g < 4; g++) {
      const group = starts.filter((s) => s.duplicate!.groupIndex === g)
      expect(group).toHaveLength(5)
      expect(new Set(group.map((s) => s.duplicate!.seed)).size).toBe(1)
      const bySeat = group.map((s) => s.seats.map((seat) => dealt.get(s.handId)![seat.playerId]!.join('')))
      for (const cards of bySeat.slice(1)) expect(cards).toEqual(bySeat[0]) // seat i gets the same hole cards
      for (let seat = 0; seat < 5; seat++) expect(new Set(group.map((s) => s.seats[seat]!.playerId)).size).toBe(5)
    }
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

describe('study results and progress', () => {
  it('computes bb/100 per group from the nets, averaged over whole neighbour blocks', () => {
    const c = config({ minGroups: 8, maxGroups: 8 })
    const p = emptyProgress()
    // Group g: jev wins (g + 1) big blinds from pill in every rotation, so jev's group bb/100 is 100 (g + 1).
    for (let g = 0; g < 8; g++) for (let r = 0; r < 5; r++) p.valid.set(handKeyOf(g, r), { jev: (g + 1) * 100, pill: -(g + 1) * 100 })
    const full = summarize(p, c, 8)
    expect(full).toMatchObject({ groups: 8, blocks: 2 })
    const jev = full.players[0]!
    expect(jev.bb100.mean).toBeCloseTo(450, 9) // blocks: 250 and 650
    expect(jev.bb100.halfWidth).toBeCloseTo(12.7062047 * 200, 3) // t(0.975, 1) x sd 282.84 / sqrt 2
    expect(jev.hands).toBe(40)
    expect(full.players[1]!.bb100.mean).toBeCloseTo(-450, 9)
    expect(full.players[2]!.bb100.mean).toBe(0)
    const partial = summarize(p, c, 7) // only the first whole block
    expect(partial).toMatchObject({ groups: 4, blocks: 1 })
    expect(partial.players[0]!.bb100).toMatchObject({ mean: 250, halfWidth: Infinity })
  })

  it('counts a hand once when a crash cut its first attempt short', () => {
    const e = (body: Record<string, unknown>) => ({ gameId: 'pilot', seq: 0, ts: 0, ...body }) as GameEvent
    const dup = (attempt: number) => ({ groupIndex: 0, rotation: 0, order: 1, seed: 7, attempt })
    const p = readProgress([
      e({ type: 'hand_started', handId: '0:0#1', duplicate: dup(1) }),
      e({ type: 'hand_started', handId: '0:0#2', duplicate: dup(2) }),
      e({ type: 'hand_ended', handId: '0:0#2', net: { jev: 5 }, stacks: {} }),
      e({ type: 'study_checkpoint', groups: 4, blocks: 1, costUsd: 0, players: [], stop: false }),
    ])
    expect(p.attempts.get('0:0')).toBe(2)
    expect(p.valid.get('0:0')).toEqual({ jev: 5 })
    expect(p.handsPlayed).toBe(1)
    expect(p.lastCheckpoint).toEqual({ groups: 4, stop: false })
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
  /** analysedGroups of the last study_ended: the groups its published results use. */
  analysedGroups: number | null
  /** The last logged stopping-rule check: resume continues from its boundary. */
  lastCheckpoint: { groups: number; stop: boolean } | null
}

export function emptyProgress(): StudyProgress {
  return { attempts: new Map(), valid: new Map(), handsPlayed: 0, lastEnd: null, analysedGroups: null, lastCheckpoint: null }
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
    } else if (e.type === 'study_checkpoint') {
      p.lastCheckpoint = { groups: e.groups, stop: e.stop }
    } else if (e.type === 'study_ended') {
      p.lastEnd = e.reason
      p.analysedGroups = e.analysedGroups
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
      bb100: tInterval(blockValues),
      // Same seed for every player: resamples are joint, keeping the players' zero-sum correlation.
      bb100Bootstrap: bootstrapMean(blockValues, config.bootstrapResamples, config.masterSeed),
      hands: groups * n,
    }
  })
  return { groups, blocks, players }
}
```

`apps/study/src/prereg.ts`:

```ts
import { canonicalJson } from '@ab/core'
import { DEFAULT_MENU_CONFIG, neighbourBlockSize } from '@ab/engine'
import { ACTION_INSTRUCTIONS, JEV_INPUT_PRICE_PER_MTOK, SYSTEM_PROMPT, WIN_INSTRUCTIONS, type PlayerSpec } from '@ab/players'
import type { StudyConfig } from './config'

/**
 * The pre-registration record: everything that can affect results, hashed into the study's game
 * config before hand 1. Budget and concurrency are left out on purpose: they only decide how far a
 * run gets, so topping up the budget and resuming doesn't change the study.
 */
export function preregistration(config: StudyConfig, adaptedLineup: PlayerSpec[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  const record = {
    kind: 'artificialBluff study',
    version: 1,
    study: { ...preregisteredConfig(config), lineup: adaptedLineup },
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
      "player's 95% Student t CI (df = blocks - 1) half-width of bb/100 is at most targetHalfWidthBb100; never " +
      'before minGroups (at least 10 blocks and a check boundary, unless the study has a fixed size); at most maxGroups; every check is ' +
      'logged as a study_checkpoint event; hands cut short by the budget cap are excluded and replayed on resume',
    intervals:
      'per-player 95% t CIs over neighbour blocks are marginal, not simultaneous; pairwise claims use paired ' +
      'contrasts with a Holm correction; percentile bootstrap CIs are reported as a sensitivity check',
  }
  const clash = Object.keys(extra).filter((k) => k in record)
  if (clash.length) throw new Error(`pre-registration: extra key(s) would overwrite the record: ${clash.join(', ')}`)
  return { ...record, ...extra }
}

/** The config fields that are pre-registered (all but budget, concurrency and the unadapted line-up). */
function preregisteredConfig(config: StudyConfig): Record<string, unknown> {
  const { budgetUsd: _budget, concurrency: _concurrency, lineup: _lineup, ...rest } = config
  return rest
}

/** Throws unless `record` is the pre-registration of `config` (same fields and line-up ids). */
export function assertPreregMatches(record: Record<string, unknown>, config: StudyConfig): void {
  const study = record.study as ({ lineup?: Array<{ id?: unknown }> } & Record<string, unknown>) | undefined
  const { lineup = [], ...fields } = study ?? {}
  const same =
    study !== undefined &&
    canonicalJson(fields) === canonicalJson(preregisteredConfig(config)) &&
    canonicalJson(lineup.map((s) => s.id)) === canonicalJson(config.lineup.map((s) => s.id))
  if (!same) throw new Error(`the pre-registration record is not for study config ${config.id}`)
}
```

`apps/study/src/run.ts`:

```ts
import { configHash, playHand, type EventStore, type StudyEndReason } from '@ab/core'
import { cashHandConfig, duplicateGroup, type DuplicateHand } from '@ab/engine'
import type { Player } from '@ab/players'
import type { StudyConfig } from './config'
import { assertPreregMatches } from './prereg'
import { completedPrefix, handKeyOf, readStoreProgress, type StudyProgress } from './progress'
import { summarize, type StudySummary } from './results'

export interface RunStudyOptions {
  config: StudyConfig
  /** Players for the line-up, in any order (matched by id). */
  players: Player[]
  store: EventStore
  /** The pre-registration record of `config` (see `preregistration`); its hash must not change across resumes. */
  prereg: Record<string, unknown>
  /** Stops scheduling new hands; hands in flight finish. */
  signal?: AbortSignal
  /** Run a study left marked 'running' (a crash). Never while another process is running it. */
  takeover?: boolean
  /** Called each time the stopping rule is checked. */
  onCheckpoint?: (summary: StudySummary, costUsd: number) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface StudyOutcome {
  reason: StudyEndReason
  /** Completed prefix of groups (before truncating to whole blocks). */
  groupsCompleted: number
  /** Results over the analysed groups (see the study_ended event's analysedGroups). */
  summary: StudySummary
  costUsd: number
  configHash: string
}

/**
 * Runs (or resumes) a duplicate study. Hands are played in group order by `concurrency` workers.
 * Results always use the completed prefix of groups in whole neighbour blocks, so the stopping rule
 * can't pick favourable groups. The rule is checked at every boundary (each multiple of checkEvery,
 * and maxGroups) in order, so where a study stops depends only on the data, never on concurrency or
 * on where a run was interrupted. Hands cut short by the budget cap don't count and are replayed
 * (as a new attempt) when the study is resumed with more budget.
 */
export async function runStudy(opts: RunStudyOptions): Promise<StudyOutcome> {
  const { config, store } = opts
  const n = config.lineup.length
  const players = new Map(opts.players.map((p) => [p.id, p]))
  for (const spec of config.lineup) if (!players.has(spec.id)) throw new Error(`no player for line-up seat ${spec.id}`)
  const ids = config.lineup.map((s) => s.id)
  assertPreregMatches(opts.prereg, config)

  const hash = configHash(opts.prereg)
  const existing = store.game(config.id)
  if (existing) {
    if (existing.kind !== 'study') throw new Error(`${config.id} is not a study`)
    if (existing.configHash !== hash) throw new Error(`study ${config.id} was pre-registered with a different config (hash ${existing.configHash.slice(0, 12)}…); use a new id`)
  }
  const finished = (q: StudyProgress): StudyOutcome | null =>
    q.lastEnd === 'ci_target' || q.lastEnd === 'max_groups'
      ? { reason: q.lastEnd, groupsCompleted: completedPrefix(q, n, config.maxGroups), summary: summarize(q, config, q.analysedGroups!), costUsd: store.gameCost(config.id), configHash: hash }
      : null
  if (existing) {
    const done = finished(readStoreProgress(store, config.id))
    if (done) return done
    store.claimGame(config.id, opts.takeover)
  } else {
    store.createGame(config.id, 'study', opts.prereg)
  }
  // Read progress only once we hold the study, so it can't be stale (another run may have just ended).
  const p = readStoreProgress(store, config.id)
  const done = finished(p)
  if (done) {
    store.setStatus(config.id, 'ended')
    return done
  }
  const sink = store.sink(config.id)
  sink.append({ type: 'game_started', kind: 'study', configHash: hash, players: ids.map((id) => players.get(id)!).map((pl) => ({ id: pl.id, kind: pl.kind, model: pl.model })) })

  const overBudget = () => store.gameCost(config.id) >= config.budgetUsd
  let stop: StudyEndReason | null = null
  let failure: unknown = null
  // Resume the check schedule after the last logged check; a met rule that was logged but never
  // reached study_ended (crash) still ends the study.
  let checkedAt = p.lastCheckpoint?.groups ?? 0
  let stopAt: number | null = p.lastCheckpoint?.stop ? p.lastCheckpoint.groups : null
  if (stopAt !== null) stop = 'ci_target'

  /** Checks the rule at every boundary the completed prefix has reached, in order; stops at the first met. */
  function checkpoints(): void {
    const prefix = completedPrefix(p, n, config.maxGroups)
    while (stopAt === null) {
      const boundary = Math.min(checkedAt + config.checkEvery, config.maxGroups)
      if (boundary <= checkedAt || boundary > prefix) return
      checkedAt = boundary
      const summary = summarize(p, config, boundary)
      const costUsd = store.gameCost(config.id)
      const met = boundary >= config.minGroups && summary.players.every((pl) => pl.bb100.halfWidth <= config.targetHalfWidthBb100)
      const finite = (x: number) => (Number.isFinite(x) ? x : null)
      sink.append({
        type: 'study_checkpoint',
        groups: boundary,
        blocks: summary.blocks,
        costUsd,
        players: summary.players.map((pl) => ({
          playerId: pl.playerId,
          bb100: finite(pl.bb100.mean),
          low: finite(pl.bb100.low),
          high: finite(pl.bb100.high),
          halfWidth: finite(pl.bb100.halfWidth),
        })),
        stop: met,
      })
      opts.onCheckpoint?.(summary, costUsd)
      if (met) {
        stopAt = boundary
        // Decided by the data, so it takes precedence over a budget cap or an interruption.
        stop = 'ci_target'
      }
    }
  }
  checkpoints() // catch up on checks a crash skipped

  function* tasks(): Generator<DuplicateHand> {
    for (let g = 0; g < config.maxGroups; g++) {
      for (const hand of duplicateGroup(config.masterSeed, g, ids)) {
        if (!p.valid.has(handKeyOf(hand.groupIndex, hand.rotation))) yield hand
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
      const attempt = (p.attempts.get(key) ?? 0) + 1
      p.attempts.set(key, attempt)
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
        p.handsPlayed++
        if (!capped) p.valid.set(key, result.net)
        checkpoints()
      } catch (e) {
        failure ??= e
        stop ??= 'interrupted'
        return
      }
    }
  }

  await Promise.all(Array.from({ length: config.concurrency }, () => worker()))
  const groupsCompleted = completedPrefix(p, n, config.maxGroups)
  const reason: StudyEndReason = stop ?? (groupsCompleted >= config.maxGroups ? 'max_groups' : 'interrupted')
  const summary = summarize(p, config, stopAt ?? groupsCompleted)
  const costUsd = store.gameCost(config.id)
  sink.append({ type: 'study_ended', reason, groupsCompleted, analysedGroups: summary.groups, handsPlayed: p.handsPlayed, costUsd })
  store.setStatus(config.id, reason === 'interrupted' ? 'interrupted' : 'ended')
  if (failure) throw failure
  return { reason, groupsCompleted, summary, costUsd, configHash: hash }
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
Expected: PASS (31 tests); typecheck clean.

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
  const lineup = await resolveLineup(c, mock, deps.log)
  const players = createPlayers(lineup, deps.env)
  const prereg = preregistration(c, lineup)
  if (mock) deps.log('mock mode: no API calls are made; costs shown are simulated')
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
 * Options: --db <path> (default data/studies.db); --takeover resumes a study a crash left marked
 * running (only if no other run of it is active). Keys come from .env (see .env.example).
 */
import { EventStore } from '@ab/core'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadStudyConfig, preregCommand, runCommand, statusCommand } from './commands'

const [command, configPath, ...rest] = process.argv.slice(2)
const mock = rest.includes('--mock')
const takeover = rest.includes('--takeover')
const dbIndex = rest.indexOf('--db')
const dbPath = dbIndex >= 0 ? rest[dbIndex + 1]! : 'data/studies.db'
if (!command || !configPath || !['prereg', 'run', 'status'].includes(command)) {
  console.error('usage: pnpm study <prereg|run|status> <config.json> [--mock] [--db path] [--takeover]')
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
    await runCommand(config, mock, store, { ...deps, signal: ac.signal, takeover })
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
Expected: PASS (35 tests); typecheck clean everywhere.

Run: `pnpm study run studies/smoke.example.json --mock --db data/study-mock.db`
Expected: "mock mode: no API calls…", the pre-registration hash, checkpoint tables, then `ended: ci_target` (identical mock strategies break exactly even, so every CI is 0 wide) with 8 groups (a fixed-size study). Costs shown are simulated.

- [ ] **Step 5: Full verification and commit**

Run: `pnpm test && pnpm typecheck`
Expected: engine 104, players 44, core 35, study 35; typecheck clean.


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

- `pnpm test` passes (engine 104, players 44, core 35, study 35); `pnpm typecheck` clean.
- `pnpm study run studies/smoke.example.json --mock` completes for free.
- Next: Plan 3b reads the study's events (and live games') to produce the report: bb/100 with CIs, cost, latency, calibration (A: main-pot share; C: expected main-pot share at decision), fallback rates, play style, CSV/JSON exports and a static HTML report.

