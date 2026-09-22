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
