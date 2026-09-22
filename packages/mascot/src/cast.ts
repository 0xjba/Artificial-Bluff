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
