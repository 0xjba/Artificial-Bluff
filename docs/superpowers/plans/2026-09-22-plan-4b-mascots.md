# artificialBluff Plan 4b: Mascots

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The five table mascots as a reusable package: the bloub animation engine (MIT, vendored) adapted so every character keeps its own body shape through every animation and wears white rings, the cast (character → shape), reaction cues for every game moment, a clock-free driver, and a React component. Plus a static preview sheet for the brand docs.

**Architecture:** `packages/mascot` (`@ab/mascot`). `src/engine/` is bloub's framework-free engine (`BotEngine.sample(t)` is a pure function of time returning SVG geometry), vendored at commit `b4bb3c1` with its upstream tests and two marked changes. On top: `cast.ts` (JEV hexagon, PILL capsule, BLOCK squircle, DRIP droplet, NIMBUS cloud), `cues.ts` (spec §8 moment → animated beats + resting face), `driver.ts` (applies a cue's beats to the engine at exact times, testable without timers), `MascotSvg.tsx` (draws one frame) and `Mascot.tsx` (requestAnimationFrame loop; still frame for SSR, previews and reduced motion). Plan 4c (the site) decides which moment each seat is in.

**Tech Stack:** TypeScript strict, Vitest, React 19 (`react-dom/server` for tests and the preview), `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-21-artificialbluff-design.md` §8 (brand, mascots, state mapping). Status/todos: `docs/STATUS.md`.

**Plan series:** 1 → 2 → 3a → 3b → 4a (all merged) → **4b Mascots (this)** → 4c Web UI (Broadcast site).

---

## Notes for the implementer

- **Vendored code:** `packages/mascot/src/engine/` is bloub (MIT, Jérémy Perret), comments in French. Change it only where a task says so, and mark each change `artificialBluff:`. Everything else stays byte-for-byte upstream (see `src/engine/README.md`). Task 1 (the verbatim copy) is done by the controller, not an implementer.
- **Shape rule:** resting states already swap in the chosen shape (`baseBody`). New: `orbit` (the win) spins the player's shape instead of a triangle; any state that draws the body as a circle of radius r (thinking dots, burst, comet, sleep dot) draws the player's shape at radius r; glyph states (the "!" of `alert`/`exclaim`) and shape states (`egg`, `hexagon`, `play`) are unchanged. No cast member is a circle (that reads as the x.ai bot the engine was measured from).
- **Colours:** bodies `#F5F3EE` on the felt `#0B2A24`; rings are neutral white (grey-scale gradient stops only).
- **Ids:** SVG mask/gradient ids come from `useId`; mascots rendered in separate React trees onto one page (the preview) must pass `id`.
- **Tests:** the upstream engine tests keep running (one of them checks 680 shape/state combinations and takes ~3 s).

## File map

| File | Responsibility |
|---|---|
| `packages/mascot/src/engine/*` | Vendored bloub engine (+ `README.md`, `../../LICENSE-bloub`) |
| `packages/mascot/src/cast.ts` | Characters and their shapes |
| `packages/mascot/src/cues.ts` | Game moments → beats + rest pose |
| `packages/mascot/src/driver.ts` | `MascotDriver`: cue timeline on the engine |
| `packages/mascot/src/MascotSvg.tsx`, `Mascot.tsx` | Rendering; animated component |
| `packages/mascot/scripts/preview.tsx` | Static sheet → `docs/brand/mascots.html` |
| `LICENSE-THIRD-PARTY` | Attribution |

---

### Task 1: Vendor the bloub engine (controller)

Done by the controller, not an implementer (it copies third-party files verbatim):

```bash
git clone https://github.com/jeremy-prt/bloub /tmp/bloub   # or an existing clone
cd /tmp/bloub && git checkout b4bb3c1
mkdir -p <repo>/packages/mascot/src/engine
for f in math profiles shape skins face expressions states eyefit decor engine repere; do cp src/bot/$f.ts <repo>/packages/mascot/src/engine/; done
for f in engine shape skins expressions face; do cp src/bot/$f.test.ts <repo>/packages/mascot/src/engine/; done
cp LICENSE <repo>/packages/mascot/LICENSE-bloub
```

Then create:

`packages/mascot/src/engine/README.md`:
```md
# Vendored: bloub engine

The files in this folder come from **bloub** by Jérémy Perret (MIT, see `../../LICENSE-bloub`):
https://github.com/jeremy-prt/bloub, `src/bot/`, commit `b4bb3c1`. Comments are the upstream French.

Only the clock-free engine is vendored (no Vue, no DOM): `math`, `profiles`, `shape`, `skins`, `face`,
`expressions`, `states`, `eyefit`, `decor`, `engine`, `repere`, with their upstream tests.

artificialBluff changes (each marked `artificialBluff:` in the code):

- `decor.ts`: rings and ribbons are neutral white (saturation 0, lightness 0.9) instead of a hue wheel.
- `engine.ts`: every player keeps its chosen body shape through every animation. `orbit` spins the
  player's shape instead of a triangle; states that draw the body as a circle draw the player's shape
  at that size; glyph states (the "!" bars) and shape states (egg, hexagon, play) are unchanged.
- `engine.test.ts`, `skins.test.ts`: the two upstream tests that pinned "a chosen shape never reaches
  the animated states" are narrowed to glyph and shape states, and new tests pin the new rule.

Keep the rest byte-for-byte upstream so future fixes can be merged.
```

`LICENSE-THIRD-PARTY`:
```text
Third-party code included in artificialBluff
============================================

bloub (packages/mascot/src/engine)
  https://github.com/jeremy-prt/bloub, commit b4bb3c1
  MIT License, Copyright (c) 2026 Jérémy Perret
  Full text: packages/mascot/LICENSE-bloub
  Modified: white rings; players keep their body shape through all animations
  (see packages/mascot/src/engine/README.md).
```

`packages/mascot/package.json` (React is added in Task 5):
```json
{
  "name": "@ab/mascot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`packages/mascot/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test", "scripts"]
}
```

`packages/mascot/src/index.ts`:
```ts
export {}
```

Verify: `pnpm install --offline && pnpm --filter @ab/mascot exec vitest run` → 71 upstream tests pass; `pnpm --filter @ab/mascot typecheck` clean (the pristine engine compiles under our strict settings).

```bash
git add packages/mascot LICENSE-THIRD-PARTY pnpm-lock.yaml
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "chore(mascot): vendor the bloub engine (MIT, b4bb3c1) with its tests" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: White rings, and every player keeps its shape

**Files:**
- Modify: `packages/mascot/src/engine/decor.ts`, `packages/mascot/src/engine/engine.ts`
- Test: `packages/mascot/src/engine/engine.test.ts`, `packages/mascot/src/engine/skins.test.ts`

- [ ] **Step 1: Change the tests**

In `packages/mascot/src/engine/engine.test.ts`, replace the test `it('laisse intacts les etats qui dessinent leur propre forme', ...)` with:
```ts
  // artificialBluff: 'sleep' moved to the next test (its body is a small circle, so it now takes the shape).
  it('laisse intacts les etats qui dessinent leur propre forme', () => {
    for (const id of ['exclaim', 'alert', 'egg', 'hexagon'] as const) {
      const nu = new BotEngine(100, id)
      const habille = new BotEngine(100, id, radii('goutte'))
      expect(habille.sample(1).bodyPath).toBe(nu.sample(1).bodyPath)
    }
  })

  // artificialBluff: every player keeps its own shape through the animations drawn as a circle.
  it('keeps the chosen shape through every state that draws the body as a circle', () => {
    for (const id of ['thinking', 'sleep', 'burst', 'comet'] as const) {
      for (const t of [0.1, 0.5, 1, 2]) {
        const nu = new BotEngine(100, id).sample(t).bodyPath
        expect(new BotEngine(100, id, radii('hexagone')).sample(t).bodyPath, `${id}@${t}`).not.toBe(nu)
        expect(new BotEngine(100, id, radii('cercle')).sample(t).bodyPath, `${id}@${t}`).toBe(nu) // a circle is a circle
      }
    }
  })

  // artificialBluff: the win animation spins the player's own shape, never the upstream triangle.
  it('spins the chosen shape in orbit, with the same rotation', () => {
    const triangle = new BotEngine(100, 'orbit').sample(0.5).bodyPath
    for (const forme of ['cercle', 'hexagone', 'goutte'] as const) {
      expect(new BotEngine(100, 'orbit', radii(forme)).sample(0.5).bodyPath).not.toBe(triangle)
    }
    // Same shape at two moments differs only by the rotation: its radius profile is the chosen one.
    const early = new BotEngine(100, 'orbit', radii('cercle')).sample(0.5).bodyPath
    expect(early).toBe(new BotEngine(100, 'orbit', radii('cercle')).sample(0.5).bodyPath)
  })
```

In `packages/mascot/src/engine/skins.test.ts`, after the line `const SILHOUETTE_MESUREE = STATES.filter((s) => !s.baseBody).map((s) => s.id)` add:
```ts
// artificialBluff: measured states drawn as a circle, which take the chosen shape.
const CIRCLE_DRAWN = new Set<StateId>(['thinking', 'sleep', 'orbit', 'burst', 'comet']) // orbit: KEEPS_SHAPE
```
and replace the test `it("la forme choisie ne touche pas aux etats a silhouette mesuree", ...)` (including its doc comment's following `it` block only) with:
```ts
  // artificialBluff: narrowed to the states whose silhouette is a glyph or another shape. States that
  // draw the body as a circle now take the chosen shape (see engine.test.ts); the test above still
  // proves no eye leaves any silhouette.
  it("la forme choisie ne touche pas aux etats a silhouette mesuree", () => {
    for (const state of SILHOUETTE_MESUREE.filter((id) => !CIRCLE_DRAWN.has(id))) {
      const nu = new BotEngine(R, state, null, null).sample(1)
      for (const forme of SHAPES) {
        const habille = new BotEngine(R, state, forme.radii, null).sample(1)
        expect(habille.eyes, `${state}/${forme.id}`).toEqual(nu.eyes)
        expect(habille.bodyPath).toBe(nu.bodyPath)
      }
    }
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @ab/mascot exec vitest run src/engine/engine.test.ts`
Expected: FAIL (the new shape tests: bodies are still circles and triangles).

- [ ] **Step 3: Implement**

In `packages/mascot/src/engine/decor.ts`, replace the line `function wheel(hue: number, s = 0.55, l = 0.62): string {` with:
```ts
/**
 * artificialBluff: rings are neutral white, not the hue wheel of the original (the brand keeps every
 * mascot white, and a rainbow read as the x.ai bot). Saturation 0 and lightness 0.9 make every stop the
 * same soft white; the gradient machinery is kept so the geometry stays exactly as upstream.
 */
export const RING_SATURATION = 0
export const RING_LIGHTNESS = 0.9

function wheel(hue: number, s = RING_SATURATION, l = RING_LIGHTNESS): string {
```

In `packages/mascot/src/engine/engine.ts`, add immediately before the doc comment `/** Interpolation de deux poses. Le decor se croise en opacite, pas en geometrie. */`:
```ts
/** artificialBluff: states that spin or move the whole body and should do it in the player's shape. */
export const KEEPS_SHAPE: ReadonlySet<StateId> = new Set<StateId>(['orbit'])

/**
 * artificialBluff: the radius of a silhouette that is a circle (every sample equal), else null.
 * Exported for tests.
 */
export function circleRadius(radii: readonly number[]): number | null {
  const first = radii[0]
  if (first === undefined) return null
  for (const r of radii) if (Math.abs(r - first) > 1e-9) return null
  return first
}
```
and in `posed()`, directly after the `if (def.baseBody && shape) { … }` block (before `if (def.baseFace && expr)`), change that block's closing `}` into:
```ts
    } else if (shape) {
      // artificialBluff: every player keeps its own body shape through every animation.
      // - `orbit` (the win) spins a triangle that relaxes into the ball: it spins the player's shape
      //   instead, with the same rotation and drift;
      // - a state that draws the body as a circle of radius r (burst, comet, the thinking dots, the
      //   sleep dot) draws the player's shape at that size, keeping the pose's rotation and squash;
      // - states drawn as glyphs (the "!" bars) or as other shapes (egg, hexagon, play) are left as
      //   they are: there, the silhouette is the message.
      if (KEEPS_SHAPE.has(def.id)) {
        pose = { ...pose, sil: { ...pose.sil, radii: shape } }
      } else {
        const r = circleRadius(pose.sil.radii)
        if (r !== null) pose = { ...pose, sil: { ...pose.sil, radii: shape.map((v) => v * r) } }
      }
    }
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/mascot exec vitest run && pnpm --filter @ab/mascot typecheck`
Expected: PASS (73 tests, including upstream's "no eye leaves any silhouette" over every shape and state); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/mascot
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(mascot): white rings; every player keeps its shape through every animation" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Cast and cues

**Files:**
- Create: `packages/mascot/src/cast.ts`, `packages/mascot/src/cues.ts`
- Test: `packages/mascot/test/cast.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/mascot/test/cast.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { CAST, characterFor } from '../src/cast'
import { CUES, cueFor, cueLength, JEV_DECIDES, type Moment } from '../src/cues'
import { EXPRESSION_BY_ID } from '../src/engine/expressions'
import { SHAPE_BY_ID } from '../src/engine/skins'
import { STATE_BY_ID } from '../src/engine/states'

describe('cast', () => {
  it('gives the five characters distinct shapes, none of them a circle', () => {
    expect(CAST.map((c) => [c.id, c.name, c.shape])).toEqual([
      ['jev', 'JEV', 'hexagone'],
      ['pill', 'PILL', 'capsule'],
      ['block', 'BLOCK', 'squircle'],
      ['drip', 'DRIP', 'goutte'],
      ['nimbus', 'NIMBUS', 'nuage'],
    ])
    for (const c of CAST) expect(SHAPE_BY_ID.has(c.shape)).toBe(true)
  })

  it('gives unknown seats a spare shape and their id in capitals', () => {
    expect(characterFor('jev')).toBe(CAST[0])
    expect(characterFor('guest', 0)).toEqual({ id: 'guest', name: 'GUEST', shape: 'galet' })
    for (let i = 0; i < 20; i++) expect(characterFor('x', i).shape).not.toBe('cercle')
  })
})

describe('cues', () => {
  it('only uses engine states and faces that exist', () => {
    for (const [moment, cue] of Object.entries(CUES)) {
      for (const beat of [...cue.beats, cue.rest]) {
        expect(STATE_BY_ID.has(beat.state), `${moment}: ${beat.state}`).toBe(true)
        if ('face' in beat && beat.face) expect(EXPRESSION_BY_ID.has(beat.face), `${moment}: ${beat.face}`).toBe(true)
      }
    }
  })

  it('maps game moments as the spec says, with Jev’s comet first when Jev decides', () => {
    const rest = (m: Moment) => CUES[m].rest
    expect(rest('deciding').state).toBe('thinking')
    expect(rest('fold').face).toBe('blase')
    expect(rest('eliminated').state).toBe('sleep')
    expect(rest('fallback').face).toBe('confus')
    expect(CUES.all_in.beats.map((b) => b.state)).toEqual(['exclaim', 'burst'])
    expect(CUES.won.beats.map((b) => b.state)).toEqual(['idle', 'orbit'])
    expect(cueFor('raise', true).beats).toEqual([JEV_DECIDES])
    expect(cueFor('all_in', true).beats.map((b) => b.state)).toEqual(['comet', 'exclaim', 'burst'])
    expect(cueLength(cueFor('all_in', true))).toBeCloseTo(2.4 + 1.2 + 2.6, 9)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/mascot exec vitest run test/cast.test.ts`
Expected: FAIL (cannot resolve `../src/cast`).

- [ ] **Step 3: Implement**

`packages/mascot/src/cast.ts`:
```ts
import type { ShapeId } from './engine/skins'

/** A seat's on-screen character: a persistent name and body shape, whatever model plays it. */
export interface Character {
  /** The seat id used in line-ups and events. */
  id: string
  /** Shown on the seat, with the model badge next to it. */
  name: string
  shape: ShapeId
}

/**
 * The five characters (spec §8). Shapes are distinct so every seat is recognisable at a glance, and no
 * seat is a circle (that would read as the x.ai bot the engine was measured from).
 */
export const CAST: readonly Character[] = [
  { id: 'jev', name: 'JEV', shape: 'hexagone' },
  { id: 'pill', name: 'PILL', shape: 'capsule' },
  { id: 'block', name: 'BLOCK', shape: 'squircle' },
  { id: 'drip', name: 'DRIP', shape: 'goutte' },
  { id: 'nimbus', name: 'NIMBUS', shape: 'nuage' },
]

/** Shapes handed to seats outside the cast, in turn (still never a circle). */
const SPARE_SHAPES: readonly ShapeId[] = ['galet', 'triangle', 'hexagone', 'capsule', 'squircle', 'goutte', 'nuage']

/** The character for a seat: from the cast by id, else a spare shape by seat index and the id in capitals. */
export function characterFor(playerId: string, seatIndex = 0): Character {
  const known = CAST.find((c) => c.id === playerId)
  if (known) return known
  return { id: playerId, name: playerId.toUpperCase(), shape: SPARE_SHAPES[seatIndex % SPARE_SHAPES.length]! }
}
```

`packages/mascot/src/cues.ts`:
```ts
import type { StateId } from './engine/states'

/** Resting faces used by the game (ids from the vendored engine). */
export type Face = 'neutre' | 'attentif' | 'excite' | 'heureux' | 'hilare' | 'triste' | 'confus' | 'blase' | 'somnolent'

/** One animated beat: an engine state, optionally with a face, held for `seconds`. */
export interface Beat {
  state: StateId
  face?: Face
  seconds: number
}

/** What a mascot does: play the beats in order, then settle into `rest` until the next cue. */
export interface Cue {
  beats: Beat[]
  rest: { state: StateId; face: Face }
}

/** Game moments with a mascot reaction (spec §8). */
export type Moment =
  | 'waiting'
  | 'deciding'
  | 'check_call'
  | 'raise'
  | 'all_in'
  | 'fold'
  | 'won'
  | 'lost_big'
  | 'eliminated'
  | 'fallback'

/**
 * Spec §8 mapping. Beat lengths follow the engine's measured state durations (exclaim 2 s, burst
 * 2.6 s, orbit 3.4 s, comet 2.4 s), trimmed where the table moves on sooner.
 */
export const CUES: Readonly<Record<Moment, Cue>> = {
  waiting: { beats: [], rest: { state: 'idle', face: 'neutre' } },
  deciding: { beats: [], rest: { state: 'thinking', face: 'neutre' } },
  check_call: { beats: [], rest: { state: 'idle', face: 'attentif' } },
  raise: { beats: [], rest: { state: 'idle', face: 'excite' } },
  all_in: { beats: [{ state: 'exclaim', seconds: 1.2 }, { state: 'burst', seconds: 2.6 }], rest: { state: 'idle', face: 'excite' } },
  fold: { beats: [], rest: { state: 'idle', face: 'blase' } },
  won: { beats: [{ state: 'idle', face: 'hilare', seconds: 1.2 }, { state: 'orbit', seconds: 3.4 }], rest: { state: 'idle', face: 'heureux' } },
  lost_big: { beats: [], rest: { state: 'idle', face: 'triste' } },
  eliminated: { beats: [], rest: { state: 'sleep', face: 'somnolent' } },
  fallback: { beats: [], rest: { state: 'idle', face: 'confus' } },
}

/** Jev's signature: a comet before its reaction whenever it decides (spec §8, "Jev decides → comet"). */
export const JEV_DECIDES: Beat = { state: 'comet', seconds: 2.4 }

/** The cue for a moment; with `jevDecided`, Jev's comet plays first. */
export function cueFor(moment: Moment, jevDecided = false): Cue {
  const cue = CUES[moment]
  return jevDecided ? { beats: [JEV_DECIDES, ...cue.beats], rest: cue.rest } : cue
}

/** Total length of a cue's beats, in seconds. */
export function cueLength(cue: Cue): number {
  return cue.beats.reduce((sum, b) => sum + b.seconds, 0)
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/mascot exec vitest run && pnpm --filter @ab/mascot typecheck`
Expected: PASS (77 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/mascot
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(mascot): cast of five shapes and reaction cues for every game moment" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Driver

**Files:**
- Create: `packages/mascot/src/driver.ts`
- Test: `packages/mascot/test/driver.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/mascot/test/driver.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { cueFor } from '../src/cues'
import { MascotDriver } from '../src/driver'

describe('MascotDriver', () => {
  it('switches beats at their exact times, then rests', () => {
    const d = new MascotDriver('hexagone', cueFor('all_in', true), 10)
    const at = (t: number) => (d.frame(t), d.state)
    expect(at(10)).toBe('comet')
    expect(at(12.39)).toBe('comet')
    expect(at(12.4)).toBe('exclaim')
    expect(at(13.6)).toBe('burst')
    expect(at(16.2)).toBe('idle') // rest
    expect(at(30)).toBe('idle')
  })

  it('applies every beat it skipped over when frames are far apart', () => {
    const d = new MascotDriver('capsule', cueFor('won'), 0)
    d.frame(100)
    expect(d.state).toBe('idle')
  })

  it('replays from the current pose when given a new cue', () => {
    const d = new MascotDriver('squircle', cueFor('waiting'), 0)
    d.frame(5)
    d.play(cueFor('all_in'), 5)
    expect((d.frame(5.1), d.state)).toBe('exclaim')
  })

  it('is deterministic: the same times give the same frames', () => {
    const run = () => {
      const d = new MascotDriver('goutte', cueFor('won'), 0)
      return [0, 0.5, 1.3, 2.5, 4.7, 6].map((t) => d.frame(t).bodyPath)
    }
    expect(run()).toEqual(run())
  })

  it('keeps each player’s shape in the win animation', () => {
    const orbitAt = (shape: 'hexagone' | 'capsule') => {
      const d = new MascotDriver(shape, cueFor('won'), 0)
      return d.frame(2).bodyPath // 1.2 s of laughing, then 0.8 s into the orbit
    }
    expect(orbitAt('hexagone')).not.toBe(orbitAt('capsule'))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/mascot exec vitest run test/driver.test.ts`
Expected: FAIL (cannot resolve `../src/driver`).

- [ ] **Step 3: Implement**

`packages/mascot/src/driver.ts`:
```ts
import type { Cue } from './cues'
import { BotEngine, type BotFrame } from './engine/engine'
import { EXPRESSION_BY_ID } from './engine/expressions'
import { RAYON } from './engine/repere'
import { SHAPE_BY_ID, type ShapeId } from './engine/skins'

/**
 * Plays cues on one engine, clock-free: `frame(now)` applies every beat change due by `now` (at its
 * exact time) and samples the engine. The same times give the same frames, so it is testable
 * without a DOM or timers, and a component only has to call it from requestAnimationFrame.
 */
export class MascotDriver {
  private readonly engine: BotEngine
  private cue: Cue
  private startedAt: number
  /** Index of the next beat to switch to (beats.length = the rest pose). */
  private next = 0

  constructor(shape: ShapeId, cue: Cue, now = 0) {
    const radii = SHAPE_BY_ID.get(shape)?.radii ?? null
    this.engine = new BotEngine(RAYON, cue.beats[0]?.state ?? cue.rest.state, radii, null)
    this.cue = cue
    this.startedAt = now
    this.enter(0, now)
  }

  /** Starts a new cue at `now` (the engine blends from whatever is on screen). */
  play(cue: Cue, now: number): void {
    this.cue = cue
    this.startedAt = now
    this.next = 0
    this.enter(0, now)
  }

  /** Changes the body shape (it morphs). */
  setShape(shape: ShapeId, now: number): void {
    this.engine.setShape(SHAPE_BY_ID.get(shape)?.radii ?? null, now)
  }

  /** The frame at `now`. Times must not go backwards past a beat change already applied. */
  frame(now: number): BotFrame {
    while (this.next <= this.cue.beats.length) {
      const at = this.boundary(this.next)
      if (now < at) break
      this.enter(this.next, at)
    }
    return this.engine.sample(now)
  }

  /** When beat i starts (i = beats.length: when the rest pose starts). */
  private boundary(i: number): number {
    let at = this.startedAt
    for (let j = 0; j < i; j++) at += this.cue.beats[j]!.seconds
    return at
  }

  /** Beat i (or the rest pose when i = beats.length) starting at `at`; advances `next`. */
  private enter(i: number, at: number): void {
    const beat = this.cue.beats[i]
    const state = beat?.state ?? this.cue.rest.state
    const face = beat ? (beat.face ?? this.cue.rest.face) : this.cue.rest.face
    this.engine.setExpression(EXPRESSION_BY_ID.get(face) ?? null, at)
    this.engine.setState(state, at)
    this.next = i + 1
  }

  /** The engine state being shown (for tests and debugging). */
  get state() {
    return this.engine.state
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/mascot exec vitest run && pnpm --filter @ab/mascot typecheck`
Expected: PASS (82 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/mascot
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(mascot): clock-free driver playing cues on the engine" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: React component

**Files:**
- Create: `packages/mascot/src/MascotSvg.tsx`, `packages/mascot/src/Mascot.tsx`, `packages/mascot/vitest.config.ts`
- Modify: `packages/mascot/package.json`, `packages/mascot/tsconfig.json`, `packages/mascot/src/index.ts`
- Test: `packages/mascot/test/render.test.tsx`

- [ ] **Step 1: Dependencies, config and the failing test**

Run (downloads React from the npm registry):
```bash
pnpm --filter @ab/mascot add -D react@19.3.0 react-dom@19.3.0 @types/react@19 @types/react-dom@19
```
then make `packages/mascot/package.json`:
```json
{
  "name": "@ab/mascot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "preview": "tsx scripts/preview.tsx"
  },
  "devDependencies": {
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "react": "19.3.0",
    "react-dom": "19.3.0"
  },
  "peerDependencies": {
    "react": "^19.2.0"
  }
}
```
(`preview` is used in Task 6), and run `pnpm install`.

`packages/mascot/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx" },
  "include": ["src", "test", "scripts"]
}
```

`packages/mascot/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({ esbuild: { jsx: 'automatic' } })
```

`packages/mascot/test/render.test.tsx`:
```ts
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CAST } from '../src/cast'
import { cueFor } from '../src/cues'
import { Mascot } from '../src/Mascot'

describe('Mascot', () => {
  it('renders a still, titled SVG with its own mask id, in white on the felt', () => {
    const html = renderToStaticMarkup(
      <div>
        <Mascot shape="hexagone" cue={cueFor('waiting')} frozenAt={0.5} title="JEV, waiting" size={120} />
        <Mascot shape="capsule" cue={cueFor('waiting')} frozenAt={0.5} title="PILL, waiting" size={120} />
      </div>,
    )
    expect(html.match(/<svg /g)).toHaveLength(2)
    expect(html).toContain('<title>JEV, waiting</title>')
    const masks = [...html.matchAll(/<mask id="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(masks).size).toBe(2)
    expect(html).toContain('fill="#F5F3EE"')
    expect(html).not.toMatch(/NaN|undefined/)
  })

  it('keeps ids apart when mascots are rendered separately, given an id', () => {
    const one = renderToStaticMarkup(<Mascot id="a" shape="hexagone" cue={cueFor('waiting')} frozenAt={0} />)
    const two = renderToStaticMarkup(<Mascot id="b" shape="capsule" cue={cueFor('waiting')} frozenAt={0} />)
    expect(one.match(/<mask id="([^"]+)"/)![1]).not.toBe(two.match(/<mask id="([^"]+)"/)![1])
  })

  it('draws every cast member in every game moment without errors, and rings only in white', () => {
    for (const c of CAST) {
      for (const moment of ['deciding', 'all_in', 'won', 'eliminated', 'fallback'] as const) {
        for (const t of [0.3, 1.5, 3, 5]) {
          const html = renderToStaticMarkup(<Mascot shape={c.shape} cue={cueFor(moment, c.id === 'jev')} frozenAt={t} />)
          expect(html, `${c.id}/${moment}@${t}`).not.toMatch(/NaN|undefined|Infinity/)
          for (const [, hex] of html.matchAll(/stop-color="#([0-9a-f]{6})"/g)) {
            expect(hex!.slice(0, 2) === hex!.slice(2, 4) && hex!.slice(2, 4) === hex!.slice(4, 6), `ring colour #${hex}`).toBe(true)
          }
        }
      }
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ab/mascot exec vitest run test/render.test.tsx`
Expected: FAIL (cannot resolve `../src/Mascot`).

- [ ] **Step 3: Implement**

`packages/mascot/src/MascotSvg.tsx`:
```ts
import type { BotFrame } from './engine/engine'
import { NOTIF_BLUE } from './engine/decor'
import { DEMI_VIEWBOX, RAYON } from './engine/repere'
import { mixHex } from './engine/skins'

/** Brand colours: every mascot is neutral white on the felt (spec §8). */
export const MASCOT_WHITE = '#F5F3EE'
export const FELT = '#0B2A24'

export interface MascotSvgProps {
  frame: BotFrame
  /** Unique per mascot on the page (mask and gradient ids). */
  uid: string
  size: number
  /** Body colour. */
  ink?: string
  /** What is behind the mascot: seen through the eyes. */
  paper?: string
  /** Accessible name, e.g. "JEV, thinking". */
  title?: string
}

/**
 * Draws one engine frame (port of the bloub Vue component's template). The eyes are holes cut in the
 * body with a mask, so they clip themselves at the silhouette's edge; the back halves of rings and the
 * burst particles are drawn behind the body.
 */
export function MascotSvg({ frame, uid, size, ink = MASCOT_WHITE, paper = FELT, title }: MascotSvgProps) {
  const VB = DEMI_VIEWBOX
  const maskId = `${uid}-mask`
  const dot = (d: BotFrame['dots'][number], key: string) => {
    const fill = d.color ?? (d.depth === undefined ? ink : mixHex(paper, ink, d.depth))
    return d.d ? (
      <path key={key} d={d.d} fill={fill} opacity={d.opacity} transform={`translate(${d.x} ${d.y}) rotate(${d.rot ?? 0}) scale(${RAYON})`} />
    ) : (
      <circle key={key} cx={d.x} cy={d.y} r={d.r} fill={fill} opacity={d.opacity} />
    )
  }
  return (
    <svg width={size} height={size} viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`} role="img" aria-label={title}>
      {title ? <title>{title}</title> : null}
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x={-VB} y={-VB} width={VB * 2} height={VB * 2}>
          <path d={frame.bodyPath} fill="#fff" />
          {frame.eyes.map((eye, i) => (
            <path key={i} d={eye.d} transform={eye.matrix} opacity={eye.alpha} fill="#000" />
          ))}
          {frame.notch ? <circle cx={frame.notch.x} cy={frame.notch.y} r={frame.notch.r} fill="#000" /> : null}
        </mask>
        {frame.arcs.map((arc) => (
          <linearGradient key={arc.id} id={`${uid}-${arc.id}`} gradientUnits="userSpaceOnUse" x1={arc.grad.x1} y1={arc.grad.y1} x2={arc.grad.x2} y2={arc.grad.y2}>
            {arc.grad.stops.map((c, i) => (
              <stop key={i} offset={i / (arc.grad.stops.length - 1)} stopColor={c} />
            ))}
          </linearGradient>
        ))}
      </defs>
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => (
          <path key={`b${arc.id}`} d={arc.back} stroke={`url(#${uid}-${arc.id})`} strokeWidth={arc.width} opacity={arc.opacity} />
        ))}
      </g>
      {frame.dotsBehind ? <g>{frame.dots.map((d, i) => dot(d, `pb${i}`))}</g> : null}
      <g opacity={frame.bodyAlpha}>
        <path d={frame.bodyPath} fill={paper} />
        <g mask={`url(#${maskId})`}>
          <rect x={-VB} y={-VB} width={VB * 2} height={VB * 2} fill={ink} />
        </g>
      </g>
      {!frame.dotsBehind ? <g>{frame.dots.map((d, i) => dot(d, `pf${i}`))}</g> : null}
      {frame.notif ? <circle cx={frame.notif.x} cy={frame.notif.y} r={frame.notif.r} fill={NOTIF_BLUE} /> : null}
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => (
          <path key={`f${arc.id}`} d={arc.front} stroke={`url(#${uid}-${arc.id})`} strokeWidth={arc.width} opacity={arc.opacity} />
        ))}
      </g>
    </svg>
  )
}
```

`packages/mascot/src/Mascot.tsx`:
```ts
'use client'
import { useEffect, useId, useRef, useState } from 'react'
import type { Cue } from './cues'
import { MascotDriver } from './driver'
import type { BotFrame } from './engine/engine'
import type { ShapeId } from './engine/skins'
import { FELT, MASCOT_WHITE, MascotSvg } from './MascotSvg'

export interface MascotProps {
  shape: ShapeId
  cue: Cue
  /** Replays the cue whenever this changes (e.g. `${handId}:${decisionCount}`); defaults to the cue itself. */
  cueKey?: string
  size?: number
  ink?: string
  paper?: string
  title?: string
  /** Draw one still frame at this time (seconds into the cue) instead of animating. */
  frozenAt?: number
  /**
   * Prefix for the SVG's mask and gradient ids. Needed only when mascots are rendered in separate
   * React trees onto one page (each tree restarts useId, so ids would collide and every body would be
   * drawn through the first mascot's mask).
   */
  id?: string
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/**
 * An animated mascot. It plays `cue` (beats, then the rest pose) and replays it whenever `cueKey`
 * changes, blending from whatever is on screen. With `frozenAt`, or when the viewer prefers reduced
 * motion, it draws a single still frame (server rendering, previews, accessibility).
 */
export function Mascot({ shape, cue, cueKey, size = 160, ink = MASCOT_WHITE, paper = FELT, title, frozenAt, id }: MascotProps) {
  const reactId = useId()
  const uid = `m${(id ?? reactId).replace(/[^A-Za-z0-9_-]/g, '')}`
  const driver = useRef<MascotDriver | null>(null)
  const clock = useRef<{ origin: number } | null>(null)
  const [frame, setFrame] = useState<BotFrame>(() => {
    const d = new MascotDriver(shape, cue, 0)
    driver.current = d
    return d.frame(frozenAt ?? 0)
  })
  const key = cueKey ?? cue

  // A new cue (or the same cue under a new key) starts from the current time.
  useEffect(() => {
    const d = driver.current
    if (!d || frozenAt !== undefined) return
    const now = clock.current ? (performance.now() - clock.current.origin) / 1000 : 0
    d.play(cue, now)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    const d = driver.current
    if (!d) return
    const now = clock.current ? (performance.now() - clock.current.origin) / 1000 : 0
    d.setShape(shape, now)
  }, [shape])

  useEffect(() => {
    const d = driver.current
    if (!d) return
    if (frozenAt !== undefined || reducedMotion()) {
      setFrame(d.frame(frozenAt ?? 0))
      return
    }
    clock.current ??= { origin: performance.now() }
    let raf = 0
    const tick = () => {
      setFrame(d.frame((performance.now() - clock.current!.origin) / 1000))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [frozenAt])

  return <MascotSvg frame={frame} uid={uid} size={size} ink={ink} paper={paper} {...(title ? { title } : {})} />
}
```

`packages/mascot/src/index.ts`:
```ts
export * from './cast'
export * from './cues'
export * from './driver'
export * from './MascotSvg'
export * from './Mascot'
export type { BotFrame } from './engine/engine'
export type { StateId } from './engine/states'
export type { ShapeId } from './engine/skins'
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @ab/mascot exec vitest run && pnpm --filter @ab/mascot typecheck`
Expected: PASS (85 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/mascot pnpm-lock.yaml
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "feat(mascot): React Mascot component (animated, or a still frame for SSR and reduced motion)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Preview sheet

**Files:**
- Create: `packages/mascot/scripts/preview.tsx`, `docs/brand/mascots.html` (generated)

- [ ] **Step 1: Write the script**

`packages/mascot/scripts/preview.tsx`:
```ts
/**
 * Writes a static preview sheet of the mascots (still frames, no scripts) for the brand docs. Each
 * mascot is rendered separately, so each gets an explicit `id` (see MascotProps.id).
 *   pnpm --filter @ab/mascot preview [out.html]   (default: docs/brand/mascots.html at the repo root)
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { CAST } from '../src/cast'
import { cueFor, type Moment } from '../src/cues'
import { Mascot } from '../src/Mascot'
import { FELT } from '../src/MascotSvg'

const PANEL = '#0E3029'
const moments: Array<{ moment: Moment; label: string; at: number }> = [
  { moment: 'deciding', label: 'deciding', at: 1.2 },
  { moment: 'check_call', label: 'check / call', at: 1 },
  { moment: 'raise', label: 'raise', at: 1 },
  { moment: 'all_in', label: 'all-in', at: 1.7 },
  { moment: 'fold', label: 'fold', at: 1 },
  { moment: 'won', label: 'wins the pot', at: 2.4 },
  { moment: 'lost_big', label: 'loses big', at: 1 },
  { moment: 'fallback', label: 'timeout / fallback', at: 1 },
  { moment: 'eliminated', label: 'eliminated', at: 1.5 },
]

const cast = CAST.map(
  (c) => `<figure><div class="card${c.id === 'jev' ? ' jev' : ''}">${renderToStaticMarkup(
    <Mascot id={`cast-${c.id}`} shape={c.shape} cue={cueFor('waiting')} frozenAt={0.6} size={150} paper={PANEL} title={`${c.name}, waiting`} />,
  )}</div><figcaption><b>${c.name}</b><br>${c.shape}</figcaption></figure>`,
).join('')

const grid = moments
  .map(
    ({ moment, label, at }) =>
      `<tr><th>${label}</th>${CAST.map((c) => `<td>${renderToStaticMarkup(<Mascot id={`${moment}-${c.id}`} shape={c.shape} cue={cueFor(moment)} frozenAt={at} size={96} title={`${c.name}, ${label}`} />)}</td>`).join('')}</tr>`,
  )
  .join('')

const jev = [0.4, 1.0, 1.8, 2.6]
  .map((t) => `<td>${renderToStaticMarkup(<Mascot id={`jev-${String(t).replace('.', '_')}`} shape="hexagone" cue={cueFor('raise', true)} frozenAt={t} size={96} title={`JEV decides, ${t} s`} />)}</td>`)
  .join('')

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>artificialBluff mascots</title>
<style>
body{margin:0;background:${FELT};color:#F3EBDD;font:14px/1.4 Barlow,system-ui,sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px}
h1{font-family:"Barlow Condensed",Barlow,sans-serif;font-size:30px;margin:0 0 4px}h1 span{color:#E8B04A}
h2{font-family:"Barlow Condensed",Barlow,sans-serif;color:#E8B04A;font-size:18px;margin:28px 0 8px}
p{color:#9DB8AE;margin:0 0 16px}
.cast{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
figure{margin:0;text-align:center}figcaption{color:#9DB8AE;font-size:13px;margin-top:6px}figcaption b{color:#F3EBDD;font-size:16px}
.card{background:${PANEL};border:1px solid #1F4A40;border-radius:8px;padding:6px}.card.jev{border:2px solid #E8B04A}
.scroll{overflow-x:auto}table{border-collapse:collapse}th{color:#9DB8AE;font-weight:500;text-align:right;padding-right:10px;white-space:nowrap}td{padding:0}
</style></head><body><main>
<h1>artificial<span>Bluff</span> · the cast</h1>
<p>Neutral white bodies, one distinct shape per seat, kept through every animation. Bloub engine by Jérémy Perret (MIT), adapted.</p>
<div class="cast">${cast}</div>
<h2>GAME MOMENTS</h2>
<div class="scroll"><table>${grid}</table></div>
<h2>JEV DECIDES · the comet, then its reaction</h2>
<div class="scroll"><table><tr><th>0.4 → 2.6 s</th>${jev}</tr></table></div>
</main></body></html>
`
const out = resolve(process.argv[2] ?? '../../docs/brand/mascots.html')
writeFileSync(out, html)
console.log(`wrote ${out}`)
```

- [ ] **Step 2: Generate and check it**

Run: `pnpm --filter @ab/mascot typecheck && pnpm --filter @ab/mascot preview`
Expected: `wrote …/docs/brand/mascots.html`. Open it in a browser: five white characters with distinct shapes (hexagon, capsule, squircle, droplet, cloud); in the moments grid every row keeps each character's shape (the thinking dots, the all-in burst, the win orbit with white rings, the sleep dot); no two mascots share a shape.

Then run `pnpm test && pnpm typecheck`: all pass (engine 112, mascot 85, players 44, core 39, analysis 20, server 42, study 49).

- [ ] **Step 3: Commit**

```bash
git add packages/mascot/scripts docs/brand/mascots.html
git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit -m "docs(mascot): preview sheet of the cast and every game moment" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## After this plan

- `@ab/mascot` gives Plan 4c `<Mascot shape cue cueKey />`, `characterFor`, `cueFor`. Plan 4c maps each seat's table view to a moment (whose turn, last action, pot won, elimination, fallback) and replays the cue when that changes.
