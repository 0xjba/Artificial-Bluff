# artificialBluff Plan 1: Monorepo and Game Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the artificialBluff TypeScript monorepo and a fully tested, pure No-Limit Hold'em engine package (`@ab/engine`): cards, seeded shuffling, hand evaluation, betting rules, side pots, the shared action menu, the live turbo tournament, and duplicate seating for the study.

**Architecture:** `packages/engine` is pure TypeScript with no I/O. A hand is an immutable-style state object: `createHand(config)` deals and posts blinds, `applyAction(state, action)` returns a new state, and the hand finishes itself (run-out, showdown, pots). `buildMenu(state)` turns legal actions into the shared, labelled option list every player chooses from. `tournament.ts` sequences hands for live games; `duplicate.ts` produces seed groups and seat rotations for the study. Later plans (players, runner, study, server, web) import this package.

**Tech Stack:** Node 20+, pnpm 10 workspaces, TypeScript 5 (strict), Vitest 2, `phe` 0.6.0 (MIT, Cactus-Kev/2+2-style 7-card evaluator; 1 = best hand, 7462 = worst).

**Spec:** `docs/superpowers/specs/2026-09-21-artificialbluff-design.md` (§3 architecture, §4 engine and formats, §10 testing).

**Plan series:** 1 Engine (this) → 2 Players, table runner, event log → 3 Study runner and report → 4 Live server, web, mascots.

---

## Domain notes for the implementer

- **Seats** are listed clockwise. `buttonIndex` points at the dealer button. Heads-up, the button posts the small blind and acts first preflop; otherwise SB and BB are the two seats after the button and the seat after the BB acts first. After the flop, the first live seat left of the button acts first.
- **Raise amounts are "raise to"**: `{ type: 'raise', to: 600 }` means the player's total commitment *this street* becomes 600. A bet is a raise from 0.
- **Minimum raise**: the increment must be at least the last full bet/raise on this street (the big blind if none). A player may always go all-in for less.
- **Incomplete all-in raise**: an all-in that raises by less than a full raise does *not* reopen betting for players who already acted; they may only call or fold. Implemented by comparing each seat's `lastActionSeq` with `lastFullRaiseSeq`.
- **Side pots**: each distinct commitment level of a non-folded player closes a pot; folded chips count in whichever levels they reach. An uncalled excess becomes a single-eligible pot, which is how it's returned.
- **Odd chips** from a split go to winners in order starting from the first seat left of the button.
- **Cards** are two-character strings: rank `23456789TJQKA` + suit `cdhs`, e.g. `"As"`, `"Td"`. No numeric "0 = empty" sentinel (a bug source in the old contracts).
- **Deal order**: one card at a time starting left of the button, two rounds; then burn + 3 flop, burn + turn, burn + river. Tests stack the deck with `arrangeDeck` to control cards.

## File map

| File | Responsibility |
|---|---|
| `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc` | Monorepo root |
| `packages/engine/package.json`, `tsconfig.json` | Engine package config |
| `packages/engine/src/cards.ts` | Card type, deck, rank helpers |
| `packages/engine/src/rng.ts` | Seeded PRNG, seed derivation, shuffle |
| `packages/engine/src/phe.d.ts` | Types for the untyped `phe` package |
| `packages/engine/src/evaluate.ts` | Hand evaluation wrapper over `phe` |
| `packages/engine/src/types.ts` | All engine types |
| `packages/engine/src/pots.ts` | Side-pot construction and pot splitting |
| `packages/engine/src/hand.ts` | Hand state machine: deal, blinds, actions, streets, showdown |
| `packages/engine/src/menu.ts` | Shared action menu (realistic sizes, labels) |
| `packages/engine/src/tournament.ts` | Live turbo tournament sequencing |
| `packages/engine/src/duplicate.ts` | Duplicate seed groups, seat rotations, study hand config |
| `packages/engine/src/index.ts` | Public exports |
| `packages/engine/test/*.test.ts` | Tests (one file per module + property test) |
| `packages/engine/test/helpers.ts` | `arrangeDeck` test helper |
| `packages/engine/test/reference-evaluator.ts` | Slow brute-force evaluator for cross-checking |

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc`
- Create: `packages/engine/package.json`, `packages/engine/tsconfig.json`
- Modify: `.gitignore` (already exists; confirm it ignores `node_modules/`)

- [ ] **Step 1: Create the root files**

`package.json`:

```json
{
  "name": "artificialbluff",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.12.1",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "types": ["node"]
  }
}
```

`.nvmrc`:
```
20
```

- [ ] **Step 2: Create the engine package config**

`packages/engine/package.json`:

```json
{
  "name": "@ab/engine",
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
    "phe": "0.6.0"
  }
}
```

`packages/engine/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Install and confirm the toolchain**

Run: `pnpm install && pnpm --filter @ab/engine exec vitest --version && pnpm --filter @ab/engine exec tsc --version`
Expected: install succeeds; prints a Vitest 2.x version and a TypeScript 5.x version.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .nvmrc packages/engine/package.json packages/engine/tsconfig.json pnpm-lock.yaml
git commit -m "chore: scaffold pnpm monorepo and engine package"
```

---

### Task 2: Cards and seeded shuffling

**Files:**
- Create: `packages/engine/src/cards.ts`, `packages/engine/src/rng.ts`
- Test: `packages/engine/test/cards-rng.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/cards-rng.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fullDeck, isCard, rankValue } from '../src/cards'
import { deriveSeed, mulberry32, shuffle } from '../src/rng'

describe('cards', () => {
  it('builds 52 unique cards', () => {
    const deck = fullDeck()
    expect(deck).toHaveLength(52)
    expect(new Set(deck).size).toBe(52)
    expect(deck.every(isCard)).toBe(true)
  })

  it('ranks deuce lowest and ace highest', () => {
    expect(rankValue('2c')).toBe(0)
    expect(rankValue('As')).toBe(12)
  })
})

describe('rng', () => {
  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 1000; i++) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })

  it('shuffle is deterministic per seed, a permutation, and non-mutating', () => {
    const deck = fullDeck()
    const s1 = shuffle(deck, 7)
    expect(shuffle(deck, 7)).toEqual(s1)
    expect(shuffle(deck, 8)).not.toEqual(s1)
    expect([...s1].sort()).toEqual([...deck].sort())
    expect(deck).toEqual(fullDeck())
  })

  it('deriveSeed separates keys and is stable', () => {
    expect(deriveSeed('study', 1)).toBe(deriveSeed('study', 1))
    expect(deriveSeed('study', 1)).not.toBe(deriveSeed('study', 2))
    expect(deriveSeed('a', 12)).not.toBe(deriveSeed('a1', 2))
    expect(deriveSeed('a:1', 2)).not.toBe(deriveSeed('a', '1:2'))
  })

  it('shuffle spreads the ace of spades roughly evenly', () => {
    const counts = new Array(52).fill(0)
    for (let seed = 0; seed < 52_000; seed++) counts[shuffle(fullDeck(), deriveSeed('u', seed)).indexOf('As')]++
    for (const c of counts) expect(Math.abs(c - 1000)).toBeLessThan(160)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ab/engine exec vitest run test/cards-rng.test.ts`
Expected: FAIL, cannot resolve `../src/cards` / `../src/rng`.

- [ ] **Step 3: Implement cards and rng**

`packages/engine/src/cards.ts`:

```ts
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const
export const SUITS = ['c', 'd', 'h', 's'] as const

export type Rank = (typeof RANKS)[number]
export type Suit = (typeof SUITS)[number]

/** A card as a two-character string, rank then suit: "As", "Td", "2c". */
export type Card = `${Rank}${Suit}`

export function fullDeck(): Card[] {
  const deck: Card[] = []
  for (const s of SUITS) for (const r of RANKS) deck.push(`${r}${s}`)
  return deck
}

export function rankOf(card: Card): Rank {
  return card[0] as Rank
}

export function suitOf(card: Card): Suit {
  return card[1] as Suit
}

/** 0 for a deuce up to 12 for an ace. */
export function rankValue(card: Card): number {
  return RANKS.indexOf(rankOf(card))
}

export function isCard(value: string): value is Card {
  return (
    value.length === 2 &&
    (RANKS as readonly string[]).includes(value[0]!) &&
    (SUITS as readonly string[]).includes(value[1]!)
  )
}
```

`packages/engine/src/rng.ts`:

```ts
import type { Card } from './cards'

/** Mulberry32: small, fast, deterministic 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * FNV-1a over the parts, then a final avalanche. Turns any key into a 32-bit seed.
 * Each part is length-prefixed, so ('a:1', 2) and ('a', '1:2') cannot collide.
 * Hashes are 32-bit: callers needing exact uniqueness over many values (hands, seed groups)
 * derive one namespace seed and add a counter to it instead of hashing each value.
 */
export function deriveSeed(...parts: Array<string | number>): number {
  const text = parts.map((p) => `${String(p).length}:${p}`).join('')
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** Fisher–Yates shuffle driven by a seed. Never mutates its input. */
export function shuffle(cards: readonly Card[], seed: number): Card[] {
  const out = [...cards]
  const rand = mulberry32(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ab/engine exec vitest run test/cards-rng.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/cards.ts packages/engine/src/rng.ts packages/engine/test/cards-rng.test.ts
git commit -m "feat(engine): cards, seeded PRNG and shuffle"
```

---

### Task 3: Hand evaluation

Wraps `phe` and cross-checks it against a slow brute-force reference, including every ranking bug found in the old on-chain evaluator.

**Files:**
- Create: `packages/engine/src/phe.d.ts`, `packages/engine/src/evaluate.ts`
- Create: `packages/engine/test/reference-evaluator.ts`
- Test: `packages/engine/test/evaluate.test.ts`

- [ ] **Step 1: Write the reference evaluator (test support, not production code)**

`packages/engine/test/reference-evaluator.ts`:

```ts
import { rankValue, suitOf, type Card } from '../src/cards'

/**
 * Deliberately simple, slow reference evaluator used only to cross-check the engine.
 * Returns a comparable tuple: [category, ...tiebreak ranks], higher is better.
 * Categories: 8 straight flush, 7 quads, 6 full house, 5 flush, 4 straight,
 * 3 trips, 2 two pair, 1 pair, 0 high card.
 */
export function referenceScore5(cards: Card[]): number[] {
  const ranks = cards.map(rankValue).sort((a, b) => b - a)
  const flush = new Set(cards.map(suitOf)).size === 1
  const unique = [...new Set(ranks)]
  let straightHigh = -1
  if (unique.length === 5) {
    if (unique[0]! - unique[4]! === 4) straightHigh = unique[0]!
    else if (unique.join(',') === '12,3,2,1,0') straightHigh = 3 // wheel, five-high
  }
  const counts = new Map<number, number>()
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1)
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const shape = groups.map((g) => g[1]).join('')
  const byGroup = groups.map((g) => g[0])
  if (flush && straightHigh >= 0) return [8, straightHigh]
  if (shape === '41') return [7, ...byGroup]
  if (shape === '32') return [6, ...byGroup]
  if (flush) return [5, ...ranks]
  if (straightHigh >= 0) return [4, straightHigh]
  if (shape === '311') return [3, ...byGroup]
  if (shape === '221') return [2, ...byGroup]
  if (shape === '2111') return [1, ...byGroup]
  return [0, ...ranks]
}

export function compareScores(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export function referenceScore7(cards: Card[]): number[] {
  let best: number[] = [-1]
  for (let a = 0; a < cards.length; a++)
    for (let b = a + 1; b < cards.length; b++) {
      const five = cards.filter((_, i) => i !== a && i !== b)
      const s = referenceScore5(five)
      if (compareScores(s, best) > 0) best = s
    }
  return best
}
```

- [ ] **Step 2: Write the failing tests**

`packages/engine/test/evaluate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fullDeck, type Card } from '../src/cards'
import { compareHands, evaluateHand } from '../src/evaluate'
import { deriveSeed, shuffle } from '../src/rng'
import { compareScores, referenceScore7 } from './reference-evaluator'

const hand = (s: string) => s.split(' ') as Card[]
const value = (s: string) => evaluateHand(hand(s))

describe('evaluateHand', () => {
  it('names categories', () => {
    expect(value('As Ks Qs Js Ts 2c 3d').category).toBe('straight_flush')
    expect(value('9c 9d 9h 9s 2c 3d 4h').category).toBe('four_of_a_kind')
    expect(value('9c 9d 9h 2s 2c 3d 4h').category).toBe('full_house')
    expect(value('Ah 9h 7h 4h 2h Kc Qd').category).toBe('flush')
    expect(value('5c 6d 7h 8s 9c 2d 2h').category).toBe('straight')
    expect(value('7c 7d 7h Ks 2c 4d 9h').category).toBe('three_of_a_kind')
    expect(value('7c 7d Kh Ks 2c 4d 9h').category).toBe('two_pair')
    expect(value('7c 7d Kh Qs 2c 4d 9h').category).toBe('one_pair')
    expect(value('Ac Jd 9h 7s 5c 3d 2h').category).toBe('high_card')
  })

  it('rejects duplicates and wrong sizes', () => {
    expect(() => evaluateHand(hand('As As Ks Qs Js'))).toThrow(/duplicate/)
    expect(() => evaluateHand(hand('As Ks Qs Js'))).toThrow(/5-7/)
  })

  it('rejects malformed cards instead of mis-evaluating them', () => {
    expect(() => evaluateHand(hand('ts Ks Qs Js As'))).toThrow(/malformed/)
    expect(() => evaluateHand(hand('10s Ks Qs Js As'))).toThrow(/malformed/)
  })

  it('reports an exact tie as 0', () => {
    expect(compareHands(value('As Kd 2c 3d 7h 8s 9c'), value('Ac Kh 2c 3d 7h 8s 9c'))).toBe(0)
  })

  // Every case the salvaged Solidity HandEvaluator got wrong (see SALVAGE.md).
  describe('regressions from the on-chain evaluator', () => {
    it('ranks a six-high straight above the wheel', () => {
      expect(compareHands(value('2c 3d 4h 5s 6c Kd Kh'), value('Ac 2d 3h 4s 5c Kd Kh'))).toBeLessThan(0)
    })
    it('ranks a broadway straight flush above a lower one', () => {
      expect(compareHands(value('As Ks Qs Js Ts 2c 3d'), value('9s 8s 7s 6s 5s 2c 3d'))).toBeLessThan(0)
    })
    it('compares flushes by highest card first', () => {
      expect(compareHands(value('Ah 7h 5h 4h 2h Kc Qd'), value('Kh Qh Jh 9h 8h 2c 3d'))).toBeLessThan(0)
    })
    it('uses the highest kicker with quads', () => {
      expect(compareHands(value('9c 9d 9h 9s Ac 2d 3h'), value('9c 9d 9h 9s Kc 2d 3h'))).toBeLessThan(0)
    })
    it('uses the first kicker with trips', () => {
      expect(compareHands(value('7c 7d 7h Ks 2c 4d 3h'), value('7c 7d 7h Qs Jc 4d 3h'))).toBeLessThan(0)
    })
    it('weights pair kickers in order', () => {
      expect(compareHands(value('7c 7d Ah 3s 2c 4d 9h'), value('7c 7d Kh Qs Jc 4d 9h'))).toBeLessThan(0)
    })
  })

  it('agrees with a brute-force reference on 20,000 random 7-card hands', () => {
    const deck = fullDeck()
    const hands = Array.from({ length: 20_000 }, (_, i) => shuffle(deck, deriveSeed('eval', i)).slice(0, 7))
    for (let i = 1; i < hands.length; i++) {
      const a = hands[i - 1]!
      const b = hands[i]!
      // compareHands(b, a) > 0 means a is better; compareScores(a, b) > 0 means the same.
      const engine = Math.sign(compareHands(evaluateHand(b), evaluateHand(a)))
      const reference = Math.sign(compareScores(referenceScore7(a), referenceScore7(b)))
      expect(engine, `${a.join(' ')} vs ${b.join(' ')}`).toBe(reference)
    }
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @ab/engine exec vitest run test/evaluate.test.ts`
Expected: FAIL, cannot resolve `../src/evaluate`.

- [ ] **Step 4: Implement the evaluator**

`packages/engine/src/phe.d.ts`:

```ts
declare module 'phe' {
  /** 1 = royal flush (best) … 7462 = 7-high (worst). */
  export function evaluateCards(cards: string[]): number
  /** 0 = straight flush … 8 = high card. */
  export function handRank(value: number): number
  export const rankDescription: string[]
}
```

`packages/engine/src/evaluate.ts`:

```ts
import { evaluateCards, handRank, rankDescription } from 'phe'
import { isCard, type Card } from './cards'

export type HandCategory =
  | 'straight_flush'
  | 'four_of_a_kind'
  | 'full_house'
  | 'flush'
  | 'straight'
  | 'three_of_a_kind'
  | 'two_pair'
  | 'one_pair'
  | 'high_card'

const CATEGORIES: HandCategory[] = [
  'straight_flush',
  'four_of_a_kind',
  'full_house',
  'flush',
  'straight',
  'three_of_a_kind',
  'two_pair',
  'one_pair',
  'high_card',
]

export interface HandValue {
  /** Lower is better: 1 is a royal flush, 7462 is the worst high card. */
  value: number
  category: HandCategory
  /** Human label, e.g. "Full House". */
  label: string
}

/** Evaluates the best 5-card hand from 5, 6 or 7 cards. */
export function evaluateHand(cards: readonly Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`evaluateHand needs 5-7 cards, got ${cards.length}`)
  }
  // phe does no validation and silently mis-evaluates bad strings, so check every card.
  const bad = cards.find((c) => !isCard(c))
  if (bad !== undefined) throw new Error(`evaluateHand got a malformed card: ${bad}`)
  if (new Set(cards).size !== cards.length) {
    throw new Error(`evaluateHand got duplicate cards: ${cards.join(' ')}`)
  }
  const value = evaluateCards([...cards])
  const idx = handRank(value)
  return { value, category: CATEGORIES[idx]!, label: rankDescription[idx]! }
}

/** Negative if a beats b, positive if b beats a, 0 on a tie. */
export function compareHands(a: HandValue, b: HandValue): number {
  return a.value - b.value
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @ab/engine exec vitest run test/evaluate.test.ts`
Expected: PASS, 11 tests (the 20,000-hand cross-check takes about 1 s).

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/phe.d.ts packages/engine/src/evaluate.ts packages/engine/test/reference-evaluator.ts packages/engine/test/evaluate.test.ts
git commit -m "feat(engine): hand evaluation via phe, cross-checked against brute force"
```

---

### Task 4: Engine types and side pots

**Files:**
- Create: `packages/engine/src/types.ts`, `packages/engine/src/pots.ts`
- Test: `packages/engine/test/pots.test.ts`

- [ ] **Step 1: Create the shared types**

`packages/engine/src/types.ts`:

```ts
import type { Card } from './cards'
import type { HandValue } from './evaluate'

export type Street = 'preflop' | 'flop' | 'turn' | 'river'

/** `raise.to` is the player's total commitment for this street after the action (bets are raises from 0). */
export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number }

export interface SeatInput {
  id: string
  stack: number
}

export interface HandConfig {
  /** Players in clockwise seat order. Every stack must be > 0. */
  seats: SeatInput[]
  /** Index into `seats` of the button. */
  buttonIndex: number
  smallBlind: number
  bigBlind: number
  seed: number
  /** Test/replay override: the full 52-card deck, top card first. Ignores `seed` when set. */
  deck?: Card[]
}

export interface SeatState {
  id: string
  /** Index into `HandState.seats`. */
  seatIndex: number
  stack: number
  startingStack: number
  /** Chips put in on the current street. */
  streetCommitted: number
  /** Chips put in over the whole hand. */
  handCommitted: number
  folded: boolean
  allIn: boolean
  hole: Card[]
  /** `seq` of this seat's last voluntary action on the current street, or null. */
  lastActionSeq: number | null
}

export type ActionKind = 'post_sb' | 'post_bb' | 'fold' | 'check' | 'call' | 'bet' | 'raise'

export interface ActionRecord {
  seq: number
  street: Street
  seatIndex: number
  playerId: string
  kind: ActionKind
  /** Chips moved from stack to pot by this action. */
  amount: number
  /** The seat's street commitment after the action. */
  to: number
  allIn: boolean
}

export interface Pot {
  amount: number
  /** Player ids that can win this pot. */
  eligible: string[]
}

export interface PotAward extends Pot {
  winners: string[]
  /** Chips each winner receives from this pot. */
  shares: Record<string, number>
}

export interface HandResult {
  /** True if two or more players reached showdown. */
  showdown: boolean
  awards: PotAward[]
  /** Hand values of players who reached showdown. */
  hands: Record<string, HandValue>
  board: Card[]
  stacks: Record<string, number>
  /** Chips won (positive) or lost (negative) this hand. */
  net: Record<string, number>
}

export interface HandState {
  config: HandConfig
  seats: SeatState[]
  /** Undealt cards, next card first. */
  deck: Card[]
  board: Card[]
  street: Street
  complete: boolean
  /** Highest street commitment. */
  currentBet: number
  /** Size of the last full bet or raise on this street (the minimum raise increment). */
  lastRaiseSize: number
  /** `seq` of the last full bet or raise on this street; -1 when none. */
  lastFullRaiseSeq: number
  /** Index into `seats` of the player to act, or null when nobody is to act. */
  toAct: number | null
  seq: number
  history: ActionRecord[]
  result: HandResult | null
}

export interface LegalActions {
  canFold: boolean
  canCheck: boolean
  /** Chips needed to call (capped at the stack), 0 when calling is not possible. */
  callAmount: number
  /** Minimum legal raise-to, or null if the seat may not raise. May equal maxRaiseTo (all-in only). */
  minRaiseTo: number | null
  /** Maximum raise-to (all-in), or null if the seat may not raise. */
  maxRaiseTo: number | null
}
```

- [ ] **Step 2: Write the failing pot tests**

`packages/engine/test/pots.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildPots, splitPot } from '../src/pots'

describe('buildPots', () => {
  it('makes one pot when everyone contributes equally', () => {
    expect(
      buildPots([
        { id: 'a', amount: 100, folded: false },
        { id: 'b', amount: 100, folded: false },
      ]),
    ).toEqual([{ amount: 200, eligible: ['a', 'b'] }])
  })

  it('builds side pots for three all-ins at different levels', () => {
    const pots = buildPots([
      { id: 'a', amount: 50, folded: false },
      { id: 'b', amount: 200, folded: false },
      { id: 'c', amount: 500, folded: false },
      { id: 'd', amount: 500, folded: false },
    ])
    expect(pots).toEqual([
      { amount: 200, eligible: ['a', 'b', 'c', 'd'] },
      { amount: 450, eligible: ['b', 'c', 'd'] },
      { amount: 600, eligible: ['c', 'd'] },
    ])
  })

  it('counts folded chips once, in the levels they reach', () => {
    const pots = buildPots([
      { id: 'a', amount: 100, folded: false },
      { id: 'f', amount: 300, folded: true },
      { id: 'b', amount: 300, folded: false },
    ])
    expect(pots).toEqual([
      { amount: 300, eligible: ['a', 'b'] },
      { amount: 400, eligible: ['b'] },
    ])
    expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(700)
  })

  it('returns an uncalled bet as a single-eligible pot', () => {
    expect(
      buildPots([
        { id: 'a', amount: 1000, folded: false },
        { id: 'b', amount: 400, folded: false },
      ]),
    ).toEqual([
      { amount: 800, eligible: ['a', 'b'] },
      { amount: 600, eligible: ['a'] },
    ])
  })
})

describe('splitPot', () => {
  it('splits evenly', () => {
    expect(splitPot(300, ['a', 'b'])).toEqual({ a: 150, b: 150 })
  })
  it('gives odd chips to the earliest winners in order', () => {
    expect(splitPot(175, ['b', 'a'])).toEqual({ b: 88, a: 87 })
    expect(splitPot(100, ['x', 'y', 'z'])).toEqual({ x: 34, y: 33, z: 33 })
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @ab/engine exec vitest run test/pots.test.ts`
Expected: FAIL, cannot resolve `../src/pots`.

- [ ] **Step 4: Implement pots**

`packages/engine/src/pots.ts`:

```ts
import type { Pot } from './types'

export interface Contribution {
  id: string
  amount: number
  folded: boolean
}

/**
 * Splits contributions into a main pot and side pots.
 * Each distinct commitment level of a non-folded player closes a pot; folded chips
 * fall into whichever levels they reach. Chips above the highest live level are
 * added to the last pot (only its eligible players can win them).
 */
export function buildPots(contributions: readonly Contribution[]): Pot[] {
  const live = contributions.filter((c) => !c.folded)
  if (live.length === 0) throw new Error('buildPots: nobody left in the hand')
  const levels = [...new Set(live.map((c) => c.amount))].sort((a, b) => a - b)
  const pots: Pot[] = []
  let previous = 0
  for (const level of levels) {
    let amount = 0
    for (const c of contributions) amount += Math.max(0, Math.min(c.amount, level) - previous)
    const eligible = live.filter((c) => c.amount >= level).map((c) => c.id)
    if (amount > 0) pots.push({ amount, eligible })
    previous = level
  }
  let above = 0
  for (const c of contributions) above += Math.max(0, c.amount - previous)
  if (above > 0) pots[pots.length - 1]!.amount += above
  return pots
}

/**
 * Splits `amount` between `winners` (already ordered from the first seat left of the
 * button). Odd chips go one each to the earliest winners in that order.
 */
export function splitPot(amount: number, winners: readonly string[]): Record<string, number> {
  const base = Math.floor(amount / winners.length)
  let odd = amount - base * winners.length
  const shares: Record<string, number> = {}
  for (const w of winners) {
    shares[w] = base + (odd > 0 ? 1 : 0)
    if (odd > 0) odd--
  }
  return shares
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @ab/engine exec vitest run test/pots.test.ts && pnpm --filter @ab/engine exec tsc --noEmit`
Expected: PASS, 6 tests; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/types.ts packages/engine/src/pots.ts packages/engine/test/pots.test.ts
git commit -m "feat(engine): engine types, side pots and odd-chip splitting"
```

---

### Task 5: Hand state machine

The core: dealing, blinds, legal actions, raising rules, street progression, all-in run-outs and showdown.

**Files:**
- Create: `packages/engine/src/hand.ts`
- Create: `packages/engine/test/helpers.ts`
- Test: `packages/engine/test/hand.test.ts`

- [ ] **Step 1: Write the deck-arranging helper**

`packages/engine/test/helpers.ts`:

```ts
import { fullDeck, type Card } from '../src/cards'

/**
 * Builds a 52-card deck that deals the given hole cards and board.
 * `holes[i]` are seat i's two cards. Dealing starts left of the button,
 * one card per round, then burn + flop, burn + turn, burn + river.
 */
export function arrangeDeck(buttonIndex: number, holes: Card[][], board: Card[] = []): Card[] {
  const n = holes.length
  const order = Array.from({ length: n }, (_, k) => (buttonIndex + 1 + k) % n)
  const used = new Set<Card>([...holes.flat(), ...board])
  const spare = fullDeck().filter((c) => !used.has(c))
  const take = () => {
    const c = spare.shift()
    if (!c) throw new Error('arrangeDeck ran out of spare cards')
    return c
  }
  const top: Card[] = []
  for (let round = 0; round < 2; round++) for (const i of order) top.push(holes[i]![round]!)
  const boardOrSpare = (k: number) => board[k] ?? take()
  top.push(take(), boardOrSpare(0), boardOrSpare(1), boardOrSpare(2))
  top.push(take(), boardOrSpare(3))
  top.push(take(), boardOrSpare(4))
  return [...top, ...spare]
}
```

- [ ] **Step 2: Write the failing tests**

`packages/engine/test/hand.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Card } from '../src/cards'
import { applyAction, createHand, legalActions, potSize } from '../src/hand'
import type { Action, HandConfig, HandState } from '../src/types'
import { arrangeDeck } from './helpers'

const c = (s: string) => s.split(' ') as Card[]

function hand(stacks: number[], opts: Partial<HandConfig> & { holes?: string[]; board?: string } = {}): HandState {
  const buttonIndex = opts.buttonIndex ?? 0
  const holes = opts.holes?.map(c)
  return createHand({
    seats: stacks.map((stack, i) => ({ id: `p${i}`, stack })),
    buttonIndex,
    smallBlind: opts.smallBlind ?? 50,
    bigBlind: opts.bigBlind ?? 100,
    seed: opts.seed ?? 1,
    deck: holes ? arrangeDeck(buttonIndex, holes, opts.board ? c(opts.board) : []) : undefined,
  })
}

function play(state: HandState, ...actions: Action[]): HandState {
  return actions.reduce((s, a) => applyAction(s, a), state)
}

const fold: Action = { type: 'fold' }
const check: Action = { type: 'check' }
const call: Action = { type: 'call' }
const raise = (to: number): Action => ({ type: 'raise', to })

describe('blinds and first to act', () => {
  it('3+ players: SB and BB after the button, UTG acts first', () => {
    const s = hand([1000, 1000, 1000, 1000])
    expect(s.seats.map((x) => x.streetCommitted)).toEqual([0, 50, 100, 0])
    expect(s.toAct).toBe(3)
    expect(s.currentBet).toBe(100)
  })

  it('heads-up: button posts SB and acts first preflop, last postflop', () => {
    let s = hand([1000, 1000], { buttonIndex: 0 })
    expect(s.seats.map((x) => x.streetCommitted)).toEqual([50, 100])
    expect(s.toAct).toBe(0)
    s = play(s, call, check)
    expect(s.street).toBe('flop')
    expect(s.toAct).toBe(1)
  })

  it('gives the big blind the option when everyone limps', () => {
    let s = hand([1000, 1000, 1000])
    s = play(s, call, call)
    expect(s.street).toBe('preflop')
    expect(s.toAct).toBe(2)
    expect(legalActions(s).canCheck).toBe(true)
    expect(legalActions(s).minRaiseTo).toBe(200)
  })

  it('short blind posts all-in for what it has', () => {
    const s = hand([1000, 30, 1000])
    expect(s.seats[1]!.streetCommitted).toBe(30)
    expect(s.seats[1]!.allIn).toBe(true)
  })

  it('postflop action starts left of the button', () => {
    let s = hand([1000, 1000, 1000, 1000], { buttonIndex: 2 })
    s = play(s, call, call, call, check)
    expect(s.street).toBe('flop')
    expect(s.toAct).toBe(3)
  })
})

describe('raising rules', () => {
  it('min raise equals the last raise size', () => {
    let s = hand([5000, 5000, 5000])
    s = play(s, raise(350)) // raise of 250
    expect(legalActions(s).minRaiseTo).toBe(600)
    expect(() => play(s, raise(500))).toThrow(/below minimum/)
  })

  it('rejects raises over the stack and non-integers', () => {
    const s = hand([1000, 1000, 1000])
    expect(() => play(s, raise(1001))).toThrow(/exceeds all-in/)
    expect(() => play(s, raise(250.5))).toThrow(/integer/)
  })

  it('allows an all-in below the minimum raise', () => {
    let s = hand([150, 1000, 1000])
    s = play(s, raise(150))
    expect(s.currentBet).toBe(150)
    expect(s.seats[0]!.allIn).toBe(true)
  })

  it('an incomplete all-in raise does not reopen betting for players who acted', () => {
    // p3 raises to 300 (full raise of 200). p0 has 400 and shoves: a 100 raise, less than 200.
    let s = hand([400, 5000, 5000, 5000])
    s = play(s, raise(300), raise(400), call, call)
    expect(s.toAct).toBe(3)
    const legal = legalActions(s)
    expect(legal.callAmount).toBe(100)
    expect(legal.minRaiseTo).toBeNull()
    expect(() => play(s, raise(1000))).toThrow(/not allowed/)
  })

  it('a full raise reopens betting', () => {
    let s = hand([5000, 5000, 5000, 5000])
    s = play(s, raise(300), raise(600), call, call)
    expect(s.toAct).toBe(3)
    expect(legalActions(s).minRaiseTo).toBe(900)
  })

  it('nobody may raise when every opponent is all-in', () => {
    // Heads-up: p0 (button, SB) limps, p1 (BB) shoves 500. p0 can only call or fold.
    let s = hand([5000, 500])
    s = play(s, call, raise(500))
    expect(s.toAct).toBe(0)
    expect(legalActions(s)).toMatchObject({ canFold: true, callAmount: 400, minRaiseTo: null, maxRaiseTo: null })
  })

  it('bets on a new street are "bet", later ones "raise"', () => {
    let s = hand([5000, 5000])
    s = play(s, call, check, raise(200), raise(600))
    const kinds = s.history.filter((h) => h.street === 'flop').map((h) => h.kind)
    expect(kinds).toEqual(['bet', 'raise'])
  })

  it('fold is illegal when checking is free, check is illegal facing a bet', () => {
    let s = hand([1000, 1000, 1000])
    expect(() => play(s, check)).toThrow(/facing a bet/)
    s = play(s, call, call)
    expect(() => play(s, fold)).toThrow(/check instead/)
  })
})

describe('hand completion', () => {
  it('awards the pot uncontested when everyone folds', () => {
    let s = hand([1000, 1000, 1000])
    s = play(s, raise(300), fold, fold)
    expect(s.complete).toBe(true)
    expect(s.result!.showdown).toBe(false)
    expect(s.result!.net).toEqual({ p0: 150, p1: -50, p2: -100 })
  })

  it('goes to showdown and pays the best hand', () => {
    let s = hand([1000, 1000], {
      holes: ['As Ad', 'Kc Kd'],
      board: '2c 7h 9s Jd 3c',
    })
    s = play(s, call, check, check, check, check, check, check, check)
    expect(s.complete).toBe(true)
    expect(s.result!.showdown).toBe(true)
    expect(s.result!.stacks).toEqual({ p0: 1100, p1: 900 })
    expect(s.board).toEqual(c('2c 7h 9s Jd 3c'))
  })

  it('runs the board out when all-in before the river', () => {
    let s = hand([1000, 1000], { holes: ['As Ad', 'Kc Kd'], board: '2c 7h 9s Jd 3c' })
    s = play(s, raise(1000), call)
    expect(s.complete).toBe(true)
    expect(s.board).toHaveLength(5)
    expect(s.result!.stacks).toEqual({ p0: 2000, p1: 0 })
  })

  it('splits a chopped pot and gives the odd chip left of the button', () => {
    // Both remaining players play the broadway straight on board. Blinds 1/3 make the pot odd.
    let s = hand([1000, 1000, 1000], {
      buttonIndex: 0,
      smallBlind: 1,
      bigBlind: 3,
      holes: ['2c 3d', '2d 3c', '4h 5h'],
      board: 'Ts Js Qd Kc Ah',
    })
    // p0 (button) raises to 6, p1 (SB) calls, p2 (BB) folds. Pot = 6 + 6 + 3 = 15.
    s = play(s, raise(6), call, fold)
    s = play(s, check, check, check, check, check, check)
    expect(s.result!.awards[0]!.winners).toEqual(['p1', 'p0'])
    expect(s.result!.stacks).toEqual({ p0: 1001, p1: 1002, p2: 997 })
  })

  it('pays side pots to the right players', () => {
    // p0 short all-in with the best hand wins only the main pot.
    let s = hand([200, 1000, 1000], {
      buttonIndex: 0,
      holes: ['As Ad', 'Kc Kd', 'Qc Qd'],
      board: '2c 7h 9s Jd 3c',
    })
    s = play(s, raise(200), raise(1000), call)
    expect(s.complete).toBe(true)
    expect(s.result!.stacks).toEqual({ p0: 600, p1: 1600, p2: 0 })
  })

  it('returns an uncalled portion of a bet', () => {
    let s = hand([1000, 400], { holes: ['As Ad', 'Kc Kd'], board: '2c 7h 9s Jd 3c' })
    s = play(s, raise(1000), call)
    expect(s.result!.stacks).toEqual({ p0: 1400, p1: 0 })
  })

  it('keeps chips constant and tracks the pot', () => {
    let s = hand([1000, 1000, 1000])
    s = play(s, raise(300))
    expect(potSize(s)).toBe(450)
    s = play(s, fold, fold)
    const total = Object.values(s.result!.stacks).reduce((a, b) => a + b, 0)
    expect(total).toBe(3000)
  })

  it('refuses actions after the hand is complete', () => {
    const s = play(hand([1000, 1000]), fold)
    expect(() => applyAction(s, check)).toThrow(/complete/)
  })

  it('is deterministic for a seed', () => {
    const a = hand([1000, 1000, 1000], { seed: 99 })
    const b = hand([1000, 1000, 1000], { seed: 99 })
    expect(a.seats.map((s) => s.hole)).toEqual(b.seats.map((s) => s.hole))
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @ab/engine exec vitest run test/hand.test.ts`
Expected: FAIL, cannot resolve `../src/hand`.

- [ ] **Step 4: Implement the hand engine**

`packages/engine/src/hand.ts`:

```ts
import { fullDeck, type Card } from './cards'
import { evaluateHand, type HandValue } from './evaluate'
import { buildPots, splitPot } from './pots'
import { shuffle } from './rng'
import type {
  Action,
  ActionKind,
  HandConfig,
  HandResult,
  HandState,
  LegalActions,
  PotAward,
  SeatState,
  Street,
} from './types'

const NEXT_STREET: Record<Street, Street | null> = { preflop: 'flop', flop: 'turn', turn: 'river', river: null }
const BOARD_CARDS: Record<Street, number> = { preflop: 0, flop: 3, turn: 1, river: 1 }

/** Seat indices clockwise starting at the seat after `from`. */
function clockwiseFrom(from: number, n: number): number[] {
  return Array.from({ length: n }, (_, k) => (from + 1 + k) % n)
}

function draw(state: HandState, count: number): Card[] {
  if (state.deck.length < count) throw new Error('deck exhausted')
  return state.deck.splice(0, count)
}

function commit(seat: SeatState, amount: number): number {
  const paid = Math.min(amount, seat.stack)
  seat.stack -= paid
  seat.streetCommitted += paid
  seat.handCommitted += paid
  if (seat.stack === 0) seat.allIn = true
  return paid
}

function record(state: HandState, seatIndex: number, kind: ActionKind, amount: number): number {
  const seat = state.seats[seatIndex]!
  const seq = state.seq++
  state.history.push({
    seq,
    street: state.street,
    seatIndex,
    playerId: seat.id,
    kind,
    amount,
    to: seat.streetCommitted,
    allIn: seat.allIn,
  })
  return seq
}

function liveSeats(state: HandState): SeatState[] {
  return state.seats.filter((s) => !s.folded)
}

function actors(state: HandState): SeatState[] {
  return state.seats.filter((s) => !s.folded && !s.allIn)
}

function needsAction(state: HandState, seat: SeatState): boolean {
  if (seat.folded || seat.allIn) return false
  return seat.lastActionSeq === null || seat.streetCommitted < state.currentBet
}

/** Next seat clockwise after `from` that must act, or null when the street is over. */
function nextToAct(state: HandState, from: number): number | null {
  const canAct = actors(state)
  if (canAct.length === 0) return null
  if (canAct.length === 1 && canAct[0]!.streetCommitted >= state.currentBet) return null
  for (const i of clockwiseFrom(from, state.seats.length)) {
    if (needsAction(state, state.seats[i]!)) return i
  }
  return null
}

function checkedDeck(deck: Card[]): Card[] {
  if (deck.length !== 52 || new Set(deck).size !== 52) throw new Error('deck override must be 52 unique cards')
  return [...deck]
}

export function createHand(config: HandConfig): HandState {
  const n = config.seats.length
  if (n < 2) throw new Error('a hand needs at least 2 players')
  if (new Set(config.seats.map((s) => s.id)).size !== n) throw new Error('player ids must be unique')
  if (config.seats.some((s) => !Number.isInteger(s.stack) || s.stack <= 0)) {
    throw new Error('every stack must be a positive integer')
  }
  if (config.buttonIndex < 0 || config.buttonIndex >= n) throw new Error('buttonIndex out of range')
  if (config.smallBlind <= 0 || config.bigBlind < config.smallBlind) throw new Error('invalid blinds')

  const state: HandState = {
    config: structuredClone(config),
    seats: config.seats.map((s, i) => ({
      id: s.id,
      seatIndex: i,
      stack: s.stack,
      startingStack: s.stack,
      streetCommitted: 0,
      handCommitted: 0,
      folded: false,
      allIn: false,
      hole: [],
      lastActionSeq: null,
    })),
    deck: config.deck ? checkedDeck(config.deck) : shuffle(fullDeck(), config.seed),
    board: [],
    street: 'preflop',
    complete: false,
    currentBet: 0,
    lastRaiseSize: config.bigBlind,
    lastFullRaiseSeq: -1,
    toAct: null,
    seq: 0,
    history: [],
    result: null,
  }

  // Deal two rounds of one card each, starting left of the button.
  const order = clockwiseFrom(config.buttonIndex, n)
  for (let round = 0; round < 2; round++) {
    for (const i of order) state.seats[i]!.hole.push(...draw(state, 1))
  }

  // Heads-up: the button posts the small blind. Otherwise the two seats after the button.
  const sbIndex = n === 2 ? config.buttonIndex : order[0]!
  const bbIndex = n === 2 ? order[0]! : order[1]!
  record(state, sbIndex, 'post_sb', commit(state.seats[sbIndex]!, config.smallBlind))
  record(state, bbIndex, 'post_bb', commit(state.seats[bbIndex]!, config.bigBlind))
  state.currentBet = config.bigBlind
  state.lastRaiseSize = config.bigBlind

  state.toAct = nextToAct(state, bbIndex)
  if (state.toAct === null) finishStreet(state)
  return state
}

export function legalActions(state: HandState): LegalActions {
  const none: LegalActions = { canFold: false, canCheck: false, callAmount: 0, minRaiseTo: null, maxRaiseTo: null }
  if (state.complete || state.toAct === null) return none
  const seat = state.seats[state.toAct]!
  const toCall = state.currentBet - seat.streetCommitted
  const maxTo = seat.streetCommitted + seat.stack
  const opponentsWhoCanAct = actors(state).filter((s) => s.seatIndex !== seat.seatIndex).length
  const reopened = seat.lastActionSeq === null || state.lastFullRaiseSeq > seat.lastActionSeq
  const canRaise = reopened && opponentsWhoCanAct > 0 && maxTo > state.currentBet
  const minTo = state.currentBet + state.lastRaiseSize
  return {
    canFold: toCall > 0,
    canCheck: toCall === 0,
    callAmount: toCall > 0 ? Math.min(toCall, seat.stack) : 0,
    minRaiseTo: canRaise ? Math.min(minTo, maxTo) : null,
    maxRaiseTo: canRaise ? maxTo : null,
  }
}

/** Returns a new state with `action` applied by the seat to act. Throws on an illegal action. */
export function applyAction(prev: HandState, action: Action): HandState {
  if (prev.complete || prev.toAct === null) throw new Error('no action expected: hand is complete')
  const state = structuredClone(prev)
  const legal = legalActions(state)
  const i = state.toAct!
  const seat = state.seats[i]!

  switch (action.type) {
    case 'fold': {
      if (!legal.canFold) throw new Error('illegal fold: nothing to call, check instead')
      seat.folded = true
      seat.lastActionSeq = record(state, i, 'fold', 0)
      break
    }
    case 'check': {
      if (!legal.canCheck) throw new Error('illegal check: facing a bet')
      seat.lastActionSeq = record(state, i, 'check', 0)
      break
    }
    case 'call': {
      if (legal.callAmount === 0) throw new Error('illegal call: nothing to call')
      seat.lastActionSeq = record(state, i, 'call', commit(seat, legal.callAmount))
      break
    }
    case 'raise': {
      if (legal.minRaiseTo === null || legal.maxRaiseTo === null) throw new Error('illegal raise: raising not allowed')
      const to = action.to
      if (!Number.isInteger(to)) throw new Error('raise amount must be an integer')
      if (to > legal.maxRaiseTo) throw new Error(`illegal raise: ${to} exceeds all-in ${legal.maxRaiseTo}`)
      if (to < legal.minRaiseTo) throw new Error(`illegal raise: ${to} below minimum ${legal.minRaiseTo}`)
      const increment = to - state.currentBet
      const kind: ActionKind = state.currentBet === 0 ? 'bet' : 'raise'
      const seq = record(state, i, kind, commit(seat, to - seat.streetCommitted))
      seat.lastActionSeq = seq
      if (increment >= state.lastRaiseSize) {
        // A full raise reopens the betting for everyone.
        state.lastRaiseSize = increment
        state.lastFullRaiseSeq = seq
      }
      state.currentBet = to
      break
    }
  }

  if (liveSeats(state).length === 1) {
    finishHand(state)
    return state
  }
  state.toAct = nextToAct(state, i)
  if (state.toAct === null) finishStreet(state)
  return state
}

function startStreet(state: HandState, street: Street): void {
  state.street = street
  draw(state, 1) // burn
  state.board.push(...draw(state, BOARD_CARDS[street]))
  state.currentBet = 0
  state.lastRaiseSize = state.config.bigBlind
  state.lastFullRaiseSeq = -1
  for (const s of state.seats) {
    s.streetCommitted = 0
    s.lastActionSeq = null
  }
}

/** Called when betting on the current street is over. Deals on, runs out, or goes to showdown. */
function finishStreet(state: HandState): void {
  for (;;) {
    const next = NEXT_STREET[state.street]
    if (next === null) {
      finishHand(state)
      return
    }
    startStreet(state, next)
    state.toAct = nextToAct(state, state.config.buttonIndex)
    if (state.toAct !== null) return
    // Nobody can bet (everyone else all-in): keep dealing until the river.
  }
}

function finishHand(state: HandState): void {
  state.complete = true
  state.toAct = null
  const n = state.seats.length
  const live = liveSeats(state)
  const showdown = live.length > 1
  const hands: Record<string, HandValue> = {}
  if (showdown) {
    for (const s of live) hands[s.id] = evaluateHand([...s.hole, ...state.board])
  }

  // Winners are listed starting from the first seat left of the button (odd-chip order).
  const order = clockwiseFrom(state.config.buttonIndex, n).map((i) => state.seats[i]!.id)
  const pots = buildPots(state.seats.map((s) => ({ id: s.id, amount: s.handCommitted, folded: s.folded })))
  const awards: PotAward[] = pots.map((pot) => {
    let winners: string[]
    if (pot.eligible.length === 1) {
      winners = [...pot.eligible]
    } else {
      const best = Math.min(...pot.eligible.map((id) => hands[id]!.value))
      winners = order.filter((id) => pot.eligible.includes(id) && hands[id]!.value === best)
    }
    return { ...pot, winners, shares: splitPot(pot.amount, winners) }
  })

  for (const award of awards) {
    for (const [id, chips] of Object.entries(award.shares)) {
      state.seats.find((s) => s.id === id)!.stack += chips
    }
  }

  const stacks: Record<string, number> = {}
  const net: Record<string, number> = {}
  for (const s of state.seats) {
    stacks[s.id] = s.stack
    net[s.id] = s.stack - s.startingStack
  }
  const result: HandResult = { showdown, awards, hands, board: [...state.board], stacks, net }
  state.result = result
}

/** Total chips in the middle, including the current street's bets. */
export function potSize(state: HandState): number {
  return state.seats.reduce((sum, s) => sum + s.handCommitted, 0)
}
```

Key points to check while reading it:
- `nextToAct` ends the street when nobody, or only one fully-matched player, can still act.
- `legalActions` allows a raise only if the seat hasn't acted since the last full raise (`reopened`), an opponent can still act, and the seat has chips beyond the current bet.
- `applyAction` records a full raise (`increment >= lastRaiseSize`) as reopening; an all-in for less only raises `currentBet`.
- `finishStreet` loops through remaining streets when nobody can bet (all-in run-out).
- `finishHand` builds pots from `handCommitted`, evaluates only live players, and orders winners from the seat left of the button.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @ab/engine exec vitest run test/hand.test.ts && pnpm --filter @ab/engine exec tsc --noEmit`
Expected: PASS, 22 tests; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/hand.ts packages/engine/test/helpers.ts packages/engine/test/hand.test.ts
git commit -m "feat(engine): NLHE hand state machine with correct raise, all-in and showdown rules"
```

---

### Task 6: Shared action menu

The only choices any player is offered: realistic preflop sizes in big blinds, postflop pot fractions, min-raise and all-in, rounded to a 25-chip unit, de-duplicated, labelled as chip amounts.

**Files:**
- Create: `packages/engine/src/menu.ts`
- Test: `packages/engine/test/menu.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/menu.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyAction, createHand } from '../src/hand'
import { buildMenu } from '../src/menu'
import type { Action, HandState } from '../src/types'

function start(stacks: number[], buttonIndex = 0): HandState {
  return createHand({
    seats: stacks.map((stack, i) => ({ id: `p${i}`, stack })),
    buttonIndex,
    smallBlind: 50,
    bigBlind: 100,
    seed: 3,
  })
}
const play = (s: HandState, ...a: Action[]) => a.reduce(applyAction, s)
const ids = (s: HandState) => buildMenu(s).map((o) => o.id)

describe('buildMenu', () => {
  it('offers opening sizes preflop when unopened', () => {
    const menu = buildMenu(start([10_000, 10_000, 10_000, 10_000]))
    expect(menu.map((o) => [o.id, o.label])).toEqual([
      ['fold', 'Fold'],
      ['call', 'Call 100'],
      ['min_raise', 'Raise to 200'],
      ['open_2_5bb', 'Raise to 250'],
      ['open_3bb', 'Raise to 300'],
      ['open_4bb', 'Raise to 400'],
      ['all_in', 'All-in 10,000'],
    ])
  })

  it('offers a 3x re-raise after an open', () => {
    const s = play(start([10_000, 10_000, 10_000, 10_000]), { type: 'raise', to: 300 })
    expect(ids(s)).toEqual(['fold', 'call', 'min_raise', 'reraise_3x', 'all_in'])
    expect(buildMenu(s).find((o) => o.id === 'reraise_3x')!.label).toBe('Raise to 900')
  })

  it('offers pot-fraction bets postflop, merging sizes that collide', () => {
    let s = start([10_000, 10_000])
    s = play(s, { type: 'call' }, { type: 'check' }) // flop, pot 200, BB to act
    // pot_33 (75) is below the 100 minimum and pot_50 (100) equals min_raise, so both drop out.
    expect(buildMenu(s).map((o) => [o.id, o.label])).toEqual([
      ['check', 'Check'],
      ['min_raise', 'Bet 100'],
      ['pot_75', 'Bet 150'],
      ['pot_100', 'Bet 200'],
      ['pot_150', 'Bet 300'],
      ['all_in', 'All-in 9,900'],
    ])
  })

  it('sizes raises against the pot after calling', () => {
    let s = start([10_000, 10_000])
    s = play(s, { type: 'call' }, { type: 'check' }, { type: 'raise', to: 200 })
    // Pot 400 incl. the bet; to call 200; pot-sized raise = 200 + (400 + 200) = 800.
    expect(buildMenu(s).find((o) => o.id === 'pot_100')!.action).toEqual({ type: 'raise', to: 800 })
  })

  it('only offers all-in when the stack cannot make a full raise', () => {
    const s = start([150, 10_000, 10_000])
    expect(ids(s)).toEqual(['fold', 'call', 'all_in'])
  })

  it('labels a call that puts the player all-in', () => {
    const s = createHand({
      seats: [
        { id: 'a', stack: 10_000 },
        { id: 'b', stack: 300 },
      ],
      buttonIndex: 0,
      smallBlind: 50,
      bigBlind: 100,
      seed: 1,
    })
    const afterShove = applyAction(s, { type: 'raise', to: 1000 })
    expect(buildMenu(afterShove).map((o) => o.label)).toEqual(['Fold', 'Call all-in 200'])
  })

  it('every option is legal', () => {
    let s = start([10_000, 10_000, 10_000])
    for (const o of buildMenu(s)) expect(() => applyAction(s, o.action)).not.toThrow()
    s = play(s, { type: 'raise', to: 300 }, { type: 'call' }, { type: 'call' })
    for (const o of buildMenu(s)) expect(() => applyAction(s, o.action)).not.toThrow()
  })

  it('returns nothing when the hand is over', () => {
    const s = play(start([1000, 1000]), { type: 'fold' })
    expect(buildMenu(s)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ab/engine exec vitest run test/menu.test.ts`
Expected: FAIL, cannot resolve `../src/menu`.

- [ ] **Step 3: Implement the menu**

`packages/engine/src/menu.ts`:

```ts
import { legalActions, potSize } from './hand'
import type { Action, HandState } from './types'

export type OptionId =
  | 'fold'
  | 'check'
  | 'call'
  | 'min_raise'
  | 'open_2_5bb'
  | 'open_3bb'
  | 'open_4bb'
  | 'reraise_3x'
  | 'pot_33'
  | 'pot_50'
  | 'pot_75'
  | 'pot_100'
  | 'pot_150'
  | 'all_in'

export interface MenuOption {
  id: OptionId
  /** Spectator/model-facing label, e.g. "Raise to 300". */
  label: string
  action: Action
  /** Chips this option moves from the stack into the pot. */
  cost: number
}

export interface MenuConfig {
  /** Raise amounts are rounded to a multiple of this. */
  chipUnit: number
}

const fmt = (n: number) => n.toLocaleString('en-US')

/**
 * The shared action menu: the only choices any player (Jev or LLM) is ever offered.
 * Every option is legal; options that land on the same amount are merged (first id wins).
 */
export function buildMenu(state: HandState, config: MenuConfig = { chipUnit: 25 }): MenuOption[] {
  const legal = legalActions(state)
  if (state.toAct === null) return []
  const seat = state.seats[state.toAct]!
  const options: MenuOption[] = []

  if (legal.canFold) options.push({ id: 'fold', label: 'Fold', action: { type: 'fold' }, cost: 0 })
  if (legal.canCheck) options.push({ id: 'check', label: 'Check', action: { type: 'check' }, cost: 0 })
  if (legal.callAmount > 0) {
    const allIn = legal.callAmount === seat.stack
    options.push({
      id: 'call',
      label: allIn ? `Call all-in ${fmt(legal.callAmount)}` : `Call ${fmt(legal.callAmount)}`,
      action: { type: 'call' },
      cost: legal.callAmount,
    })
  }

  if (legal.minRaiseTo !== null && legal.maxRaiseTo !== null) {
    const min = legal.minRaiseTo
    const max = legal.maxRaiseTo
    const bb = state.config.bigBlind
    const unit = config.chipUnit
    const round = (x: number) => Math.max(unit, Math.round(x / unit) * unit)
    const verb = state.currentBet === 0 ? 'Bet' : 'Raise to'
    const candidates: Array<[OptionId, number]> = [['min_raise', min]]

    if (state.street === 'preflop') {
      const unopened = state.currentBet === bb && state.history.every((h) => h.kind !== 'raise' && h.kind !== 'bet')
      if (unopened) {
        candidates.push(['open_2_5bb', round(2.5 * bb)], ['open_3bb', round(3 * bb)], ['open_4bb', round(4 * bb)])
      } else {
        candidates.push(['reraise_3x', round(3 * state.currentBet)])
      }
    } else {
      const toCall = state.currentBet - seat.streetCommitted
      const base = potSize(state) + toCall
      const fractions: Array<[OptionId, number]> = [
        ['pot_33', 1 / 3],
        ['pot_50', 0.5],
        ['pot_75', 0.75],
        ['pot_100', 1],
        ['pot_150', 1.5],
      ]
      for (const [id, f] of fractions) candidates.push([id, round(state.currentBet + f * base)])
    }

    const seen = new Set<number>()
    for (const [id, to] of candidates) {
      if (to < min || to >= max || seen.has(to)) continue
      seen.add(to)
      options.push({
        id,
        label: `${verb} ${fmt(to)}`,
        action: { type: 'raise', to },
        cost: to - seat.streetCommitted,
      })
    }
    options.push({
      id: 'all_in',
      label: `All-in ${fmt(max)}`,
      action: { type: 'raise', to: max },
      cost: max - seat.streetCommitted,
    })
  }
  return options
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ab/engine exec vitest run test/menu.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/menu.ts packages/engine/test/menu.test.ts
git commit -m "feat(engine): shared action menu with realistic bet sizes"
```

---

### Task 7: Live turbo tournament

**Files:**
- Create: `packages/engine/src/tournament.ts`
- Test: `packages/engine/test/tournament.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/tournament.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyAction, createHand, legalActions } from '../src/hand'
import {
  createTournament,
  currentLevel,
  endTournament,
  liveTurboConfig,
  nextHandConfig,
  recordHand,
  type TournamentState,
} from '../src/tournament'
import type { HandResult } from '../src/types'

const ids = ['jev', 'pill', 'block', 'drip', 'nimbus']

function result(stacks: Record<string, number>): HandResult {
  return { showdown: false, awards: [], hands: {}, board: [], stacks, net: {} }
}

describe('tournament', () => {
  it('starts everyone at 3,000 with blinds 25/50 and the button on seat 0', () => {
    const t = createTournament(ids, liveTurboConfig('s'))
    const cfg = nextHandConfig(t)
    expect(cfg.seats.map((s) => s.stack)).toEqual([3000, 3000, 3000, 3000, 3000])
    expect([cfg.smallBlind, cfg.bigBlind]).toEqual([25, 50])
    expect(cfg.buttonIndex).toBe(0)
  })

  it('raises blinds every 8 hands', () => {
    let t = createTournament(ids, liveTurboConfig('s'))
    const same = Object.fromEntries(ids.map((id) => [id, 3000]))
    for (let i = 0; i < 8; i++) t = recordHand(t, result(same))
    expect(currentLevel(t)).toEqual({ smallBlind: 50, bigBlind: 100 })
    for (let i = 0; i < 8; i++) t = recordHand(t, result(same))
    expect(currentLevel(t)).toEqual({ smallBlind: 75, bigBlind: 150 })
  })

  it('rotates the button clockwise, skipping busted players', () => {
    let t = createTournament(ids, liveTurboConfig('s'))
    t = recordHand(t, result({ jev: 6000, pill: 0, block: 3000, drip: 3000, nimbus: 3000 }))
    expect(t.buttonSeat).toBe(2) // seat 1 (pill) is out
    const cfg = nextHandConfig(t)
    expect(cfg.seats.map((s) => s.id)).toEqual(['jev', 'block', 'drip', 'nimbus'])
    expect(cfg.buttonIndex).toBe(1)
  })

  it('records eliminations, shorter starting stack out first', () => {
    let t = createTournament(['a', 'b', 'c'], liveTurboConfig('s'))
    t = recordHand(t, result({ a: 1000, b: 3000, c: 5000 }))
    t = recordHand(t, result({ a: 0, b: 0, c: 9000 }))
    expect(t.eliminated).toEqual(['a', 'b'])
    expect(t.complete).toBe(true)
    expect(t.winner).toBe('c')
    expect(t.endReason).toBe('last_player')
  })

  it('ends at the hand cap with the chip leader as winner', () => {
    let t = createTournament(['a', 'b'], { ...liveTurboConfig('s'), maxHands: 3 })
    t = recordHand(t, result({ a: 2000, b: 4000 }))
    t = recordHand(t, result({ a: 2500, b: 3500 }))
    t = recordHand(t, result({ a: 2400, b: 3600 }))
    expect(t.complete).toBe(true)
    expect(t.winner).toBe('b')
    expect(t.endReason).toBe('hand_cap')
    expect(() => nextHandConfig(t)).toThrow(/complete/)
  })

  it('can be ended early for the budget cap', () => {
    const t = endTournament(createTournament(['a', 'b'], liveTurboConfig('s')), 'budget_cap')
    expect(t.complete).toBe(true)
    expect(t.endReason).toBe('budget_cap')
  })

  it('derives a different deck seed per hand, stable per master seed', () => {
    const a = createTournament(ids, liveTurboConfig('x'))
    const b = createTournament(ids, liveTurboConfig('x'))
    expect(nextHandConfig(a).seed).toBe(nextHandConfig(b).seed)
    const a2 = recordHand(a, result(Object.fromEntries(ids.map((id) => [id, 3000]))))
    expect(nextHandConfig(a2).seed).not.toBe(nextHandConfig(a).seed)
  })

  it('plays a full tournament to completion with a simple bot, conserving chips', () => {
    let t: TournamentState = createTournament(ids, liveTurboConfig('full'))
    while (!t.complete) {
      let h = createHand(nextHandConfig(t))
      // Bot: shove (or call when raising isn't allowed) with any pair or an ace, otherwise check/fold.
      while (!h.complete) {
        const [x, y] = h.seats[h.toAct!]!.hole
        const strong = x![0] === y![0] || x![0] === 'A' || y![0] === 'A'
        const legal = legalActions(h)
        if (strong && legal.maxRaiseTo !== null) h = applyAction(h, { type: 'raise', to: legal.maxRaiseTo })
        else if (strong && legal.callAmount > 0) h = applyAction(h, { type: 'call' })
        else h = applyAction(h, legal.canCheck ? { type: 'check' } : { type: 'fold' })
      }
      t = recordHand(t, h.result!)
      expect(t.players.reduce((s, p) => s + p.stack, 0)).toBe(15_000)
    }
    expect(t.winner).not.toBeNull()
    expect(t.handNumber).toBeLessThanOrEqual(120)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ab/engine exec vitest run test/tournament.test.ts`
Expected: FAIL, cannot resolve `../src/tournament`.

- [ ] **Step 3: Implement the tournament**

`packages/engine/src/tournament.ts`:

```ts
import { deriveSeed } from './rng'
import type { HandConfig, HandResult } from './types'

export interface BlindLevel {
  smallBlind: number
  bigBlind: number
}

export const TURBO_LEVELS: BlindLevel[] = [
  { smallBlind: 25, bigBlind: 50 },
  { smallBlind: 50, bigBlind: 100 },
  { smallBlind: 75, bigBlind: 150 },
  { smallBlind: 100, bigBlind: 200 },
  { smallBlind: 150, bigBlind: 300 },
  { smallBlind: 200, bigBlind: 400 },
  { smallBlind: 300, bigBlind: 600 },
  { smallBlind: 400, bigBlind: 800 },
  { smallBlind: 600, bigBlind: 1200 },
  { smallBlind: 800, bigBlind: 1600 },
  { smallBlind: 1000, bigBlind: 2000 },
  { smallBlind: 1500, bigBlind: 3000 },
  { smallBlind: 2000, bigBlind: 4000 },
]

export interface TournamentConfig {
  startingStack: number
  levels: BlindLevel[]
  handsPerLevel: number
  /** Hard stop: after this many hands the chip leader wins. */
  maxHands: number
  /** Master seed; each hand's deck seed is derived from it. */
  seed: string
}

/** The live spectator format from the spec: 3,000 chips, blinds up every 8 hands, stop at hand 120. */
export function liveTurboConfig(seed: string): TournamentConfig {
  return { startingStack: 3000, levels: TURBO_LEVELS, handsPerLevel: 8, maxHands: 120, seed }
}

export type EndReason = 'last_player' | 'hand_cap' | 'budget_cap' | 'interrupted'

export interface TournamentPlayer {
  id: string
  stack: number
  eliminatedAtHand: number | null
}

export interface TournamentState {
  config: TournamentConfig
  /** Clockwise seat order; eliminated players stay in place with stack 0. */
  players: TournamentPlayer[]
  /** Hands completed so far. */
  handNumber: number
  /** Index into `players` of the button for the next hand. */
  buttonSeat: number
  complete: boolean
  winner: string | null
  endReason: EndReason | null
  /** Player ids in elimination order (first out first). */
  eliminated: string[]
}

export function createTournament(playerIds: string[], config: TournamentConfig): TournamentState {
  if (playerIds.length < 2) throw new Error('a tournament needs at least 2 players')
  if (new Set(playerIds).size !== playerIds.length) throw new Error('player ids must be unique')
  return {
    config,
    players: playerIds.map((id) => ({ id, stack: config.startingStack, eliminatedAtHand: null })),
    handNumber: 0,
    buttonSeat: 0,
    complete: false,
    winner: null,
    endReason: null,
    eliminated: [],
  }
}

export function currentLevel(t: TournamentState): BlindLevel {
  const idx = Math.min(Math.floor(t.handNumber / t.config.handsPerLevel), t.config.levels.length - 1)
  return t.config.levels[idx]!
}

export function levelIndex(t: TournamentState): number {
  return Math.min(Math.floor(t.handNumber / t.config.handsPerLevel), t.config.levels.length - 1)
}

export function nextHandConfig(t: TournamentState): HandConfig {
  if (t.complete) throw new Error('tournament is complete')
  const alive = t.players.filter((p) => p.stack > 0)
  const buttonId = t.players[t.buttonSeat]!.id
  const level = currentLevel(t)
  return {
    seats: alive.map((p) => ({ id: p.id, stack: p.stack })),
    buttonIndex: alive.findIndex((p) => p.id === buttonId),
    smallBlind: level.smallBlind,
    bigBlind: level.bigBlind,
    // Namespace hash + hand counter: every hand in a tournament gets a distinct deck seed.
    seed: (deriveSeed(t.config.seed, 'hands') + t.handNumber) >>> 0,
  }
}

function nextAliveSeat(t: TournamentState, from: number): number {
  const n = t.players.length
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n
    if (t.players[i]!.stack > 0) return i
  }
  return from
}

function chipLeader(t: TournamentState): string {
  let best = t.players[0]!
  for (const p of t.players) if (p.stack > best.stack) best = p
  return best.id
}

/** Applies a finished hand's stacks, eliminates busted players, rotates the button, checks for the end. */
export function recordHand(prev: TournamentState, result: HandResult): TournamentState {
  if (prev.complete) throw new Error('tournament is complete')
  const t = structuredClone(prev)
  const startStacks = new Map(t.players.map((p) => [p.id, p.stack]))
  for (const p of t.players) if (p.id in result.stacks) p.stack = result.stacks[p.id]!

  // Busted in the same hand: the one who started the hand with fewer chips finishes lower (goes out first).
  const busted = t.players
    .filter((p) => p.stack === 0 && p.eliminatedAtHand === null)
    .sort((a, b) => startStacks.get(a.id)! - startStacks.get(b.id)!)
  for (const p of busted) {
    p.eliminatedAtHand = t.handNumber
    t.eliminated.push(p.id)
  }

  t.handNumber += 1
  t.buttonSeat = nextAliveSeat(t, t.buttonSeat)

  const alive = t.players.filter((p) => p.stack > 0)
  if (alive.length <= 1) {
    t.complete = true
    t.winner = alive[0]?.id ?? chipLeader(t)
    t.endReason = 'last_player'
  } else if (t.handNumber >= t.config.maxHands) {
    return endTournament(t, 'hand_cap')
  }
  return t
}

/** Ends the tournament now; the chip leader (earliest seat on ties) wins. */
export function endTournament(prev: TournamentState, reason: Exclude<EndReason, 'last_player'>): TournamentState {
  const t = structuredClone(prev)
  t.complete = true
  t.winner = chipLeader(t)
  t.endReason = reason
  return t
}
```

Note: the button moves to the next seat with chips after every hand (a simple moving button; no dead-button rule). This is a deliberate simplification for a 5-max AI table.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ab/engine exec vitest run test/tournament.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/tournament.ts packages/engine/test/tournament.test.ts
git commit -m "feat(engine): live turbo tournament with blind levels, eliminations and hand cap"
```

---

### Task 8: Duplicate seating for the study

**Files:**
- Create: `packages/engine/src/duplicate.ts`
- Test: `packages/engine/test/duplicate.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/duplicate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cashHandConfig, duplicateGroup, seatRotations } from '../src/duplicate'
import { createHand } from '../src/hand'

const players = ['jev', 'pill', 'block', 'drip', 'nimbus']

describe('duplicate', () => {
  it('puts every player in every seat exactly once', () => {
    const rotations = seatRotations(players)
    expect(rotations).toHaveLength(5)
    for (let seat = 0; seat < 5; seat++) {
      expect(new Set(rotations.map((r) => r[seat])).size).toBe(5)
    }
  })

  it('shares one deck seed across a group, different across groups', () => {
    const g0 = duplicateGroup('m', 0, players)
    const g1 = duplicateGroup('m', 1, players)
    expect(new Set(g0.map((h) => h.seed)).size).toBe(1)
    expect(g0[0]!.seed).not.toBe(g1[0]!.seed)
    const seeds = Array.from({ length: 10_000 }, (_, g) => duplicateGroup('m', g, players)[0]!.seed)
    expect(new Set(seeds).size).toBe(10_000)
  })

  it('deals the same cards to the same seat in every rotation', () => {
    const hands = duplicateGroup('m', 7, players).map((d) => createHand(cashHandConfig(d)))
    for (let seat = 0; seat < 5; seat++) {
      const holes = hands.map((h) => h.seats[seat]!.hole.join(''))
      expect(new Set(holes).size).toBe(1)
    }
    const jevCards = hands.map((h) => h.seats.find((s) => s.id === 'jev')!.hole.join(''))
    expect(new Set(jevCards).size).toBe(5)
  })

  it('starts every study hand at 100 big blinds with the button on seat 0', () => {
    const cfg = cashHandConfig(duplicateGroup('m', 0, players)[2]!)
    expect(cfg.seats.every((s) => s.stack === 10_000)).toBe(true)
    expect(cfg.buttonIndex).toBe(0)
    expect([cfg.smallBlind, cfg.bigBlind]).toEqual([50, 100])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ab/engine exec vitest run test/duplicate.test.ts`
Expected: FAIL, cannot resolve `../src/duplicate`.

- [ ] **Step 3: Implement duplicate seating**

`packages/engine/src/duplicate.ts`:

```ts
import { deriveSeed } from './rng'
import type { HandConfig } from './types'

/**
 * Cyclic seat rotations: rotation r puts players[(i + r) % n] in seat i.
 * Across n rotations every player sits in every seat exactly once.
 */
export function seatRotations<T>(players: readonly T[]): T[][] {
  const n = players.length
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, i) => players[(i + r) % n]!))
}

export interface DuplicateHand {
  groupIndex: number
  rotation: number
  /** Deck seed, shared by every rotation in the group. */
  seed: number
  /** Player ids in seat order for this rotation. */
  seating: string[]
}

/** One seed group: the same deck played once per rotation. */
export function duplicateGroup(masterSeed: string, groupIndex: number, players: readonly string[]): DuplicateHand[] {
  // Namespace hash + group counter: distinct groups always get distinct decks (no hash collisions).
  const seed = (deriveSeed(masterSeed, 'groups') + groupIndex) >>> 0
  return seatRotations(players).map((seating, rotation) => ({ groupIndex, rotation, seed, seating }))
}

export interface CashFormat {
  smallBlind: number
  bigBlind: number
  /** Stack reset every hand, in big blinds. */
  stackInBigBlinds: number
}

export const STUDY_CASH: CashFormat = { smallBlind: 50, bigBlind: 100, stackInBigBlinds: 100 }

/** Hand config for one duplicate hand: fresh equal stacks, button fixed at seat 0. */
export function cashHandConfig(hand: DuplicateHand, format: CashFormat = STUDY_CASH): HandConfig {
  return {
    seats: hand.seating.map((id) => ({ id, stack: format.stackInBigBlinds * format.bigBlind })),
    buttonIndex: 0,
    smallBlind: format.smallBlind,
    bigBlind: format.bigBlind,
    seed: hand.seed,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ab/engine exec vitest run test/duplicate.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/duplicate.ts packages/engine/test/duplicate.test.ts
git commit -m "feat(engine): duplicate seed groups and seat rotations"
```

---

### Task 9: Public exports and random-play invariants

**Files:**
- Create: `packages/engine/src/index.ts`
- Test: `packages/engine/test/hand.property.test.ts`

- [ ] **Step 1: Write the property test**

Plays 3,000 random hands (2–5 players, random stacks and button) choosing uniformly from the menu, and asserts after every action and at the end: chips are conserved, net results sum to zero, awarded pots equal chips committed, no card appears twice, every showdown has a full board, and every hand ends within 200 actions. Also proves every menu option is legal (an illegal one would throw).

`packages/engine/test/hand.property.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyAction, createHand } from '../src/hand'
import { buildMenu } from '../src/menu'
import { deriveSeed, mulberry32 } from '../src/rng'

describe('random play invariants', () => {
  it('holds over 3,000 random hands', () => {
    for (let h = 0; h < 3000; h++) {
      const rand = mulberry32(deriveSeed('prop', h))
      const n = 2 + Math.floor(rand() * 4)
      const seats = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, stack: 25 * (1 + Math.floor(rand() * 400)) }))
      const total = seats.reduce((s, x) => s + x.stack, 0)
      let state = createHand({
        seats,
        buttonIndex: Math.floor(rand() * n),
        smallBlind: 25,
        bigBlind: 50,
        seed: deriveSeed('deck', h),
      })
      let steps = 0
      while (!state.complete) {
        const menu = buildMenu(state)
        expect(menu.length).toBeGreaterThan(0)
        const pick = menu[Math.floor(rand() * menu.length)]!
        state = applyAction(state, pick.action)
        const inPlay = state.seats.reduce((s, x) => s + x.stack + x.handCommitted, 0)
        if (!state.complete) expect(inPlay).toBe(total)
        expect(++steps).toBeLessThan(200)
      }
      const r = state.result!
      expect(Object.values(r.stacks).reduce((a, b) => a + b, 0)).toBe(total)
      expect(Object.values(r.net).reduce((a, b) => a + b, 0)).toBe(0)
      expect(r.awards.reduce((s, a) => s + a.amount, 0)).toBe(state.seats.reduce((s, x) => s + x.handCommitted, 0))
      const cards = [...state.seats.flatMap((s) => s.hole), ...state.board, ...state.deck]
      expect(new Set(cards).size).toBe(cards.length)
      expect(state.board.length === 5 || !r.showdown).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @ab/engine exec vitest run test/hand.property.test.ts`
Expected: PASS, 1 test (about 0.6 s). If it fails, the failing seed is reproducible: debug with superpowers:systematic-debugging before changing any code.

- [ ] **Step 3: Create the public entry point**

`packages/engine/src/index.ts`:

```ts
export * from './cards'
export * from './rng'
export * from './evaluate'
export * from './types'
export * from './pots'
export * from './hand'
export * from './menu'
export * from './tournament'
export * from './duplicate'
```

- [ ] **Step 4: Run the full suite and typecheck from the root**

Run: `pnpm test && pnpm typecheck`
Expected: 8 test files, 66 tests passed; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/index.ts packages/engine/test/hand.property.test.ts
git commit -m "feat(engine): public exports and random-play invariant tests"
```

---

## Done when

- `pnpm test` passes 66 tests across 8 files; `pnpm typecheck` is clean.
- `@ab/engine` exports: cards/rng/evaluate helpers, `createHand`, `applyAction`, `legalActions`, `potSize`, `buildMenu`, tournament functions (`createTournament`, `nextHandConfig`, `recordHand`, `endTournament`, `liveTurboConfig`, `currentLevel`, `levelIndex`), and duplicate functions (`seatRotations`, `duplicateGroup`, `cashHandConfig`, `STUDY_CASH`).
- Next: Plan 2 (players, table runner, event log) builds on these exports.

