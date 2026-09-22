import type { StateId } from './engine/states'

/** Resting faces used by the game (ids from the vendored engine). */
export type Face = 'neutre' | 'attentif' | 'excite' | 'heureux' | 'hilare' | 'triste' | 'confus' | 'blase' | 'somnolent'

/** One animated beat: an engine state, optionally with a face, held for `seconds`. */
export interface Beat {
  state: StateId
  face?: Face
  seconds: number
}

/**
 * What a mascot does: play the beats in order, then settle into `rest` until the next cue. A face only
 * shows on states that have a resting face (idle and the like); `thinking` and `sleep` keep their own.
 */
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

const JEV_CUES = new Map<Moment, Cue>()

/**
 * The cue for a moment; with `jevDecided`, Jev's comet plays first. The same arguments always give the
 * same object, so a component keyed on the cue doesn't replay it on every re-render.
 */
export function cueFor(moment: Moment, jevDecided = false): Cue {
  const cue = CUES[moment]
  if (!jevDecided) return cue
  let withComet = JEV_CUES.get(moment)
  if (!withComet) JEV_CUES.set(moment, (withComet = { beats: [JEV_DECIDES, ...cue.beats], rest: cue.rest }))
  return withComet
}

/** A key that changes exactly when the cue's content does (for components not given a key). */
export function cueSignature(cue: Cue): string {
  return `${cue.beats.map((b) => `${b.state}/${b.face ?? ''}/${b.seconds}`).join(',')}|${cue.rest.state}/${cue.rest.face}`
}

/** Total length of a cue's beats, in seconds. */
export function cueLength(cue: Cue): number {
  return cue.beats.reduce((sum, b) => sum + b.seconds, 0)
}
