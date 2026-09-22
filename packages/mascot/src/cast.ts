import type { ShapeId } from './engine/skins'

/** A seat's on-screen character: a persistent name and body shape, whatever model plays it. */
export interface Character {
  /** The seat id used in line-ups and events. */
  id: string
  /** Shown on the seat, with the model badge next to it. */
  name: string
  shape: ShapeId
  /** Body colour (and the seat's accent colour on screen). */
  color: string
}

/**
 * The five characters (spec §8). Shapes and colours are distinct so every seat is recognisable at a
 * glance, and no seat is a circle (that would read as the x.ai bot the engine was measured from).
 */
export const CAST: readonly Character[] = [
  { id: 'jev', name: 'JEV', shape: 'hexagone', color: '#E8B04A' },
  { id: 'pill', name: 'PILL', shape: 'capsule', color: '#EFE6D6' },
  { id: 'block', name: 'BLOCK', shape: 'squircle', color: '#D9534F' },
  { id: 'drip', name: 'DRIP', shape: 'goutte', color: '#3FA98C' },
  { id: 'nimbus', name: 'NIMBUS', shape: 'nuage', color: '#AC93E8' },
]

/** Eye colour: the dark ink seen through the coloured bodies. */
export const EYE_INK = '#14251F'

/** Colours for seats outside the cast, in turn. */
const SPARE_COLORS: readonly string[] = ['#9DB8AE', '#E2756F', '#8FD6BD', '#E8B04A', '#EFE6D6', '#3FA98C', '#AC93E8']

/** Shapes handed to seats outside the cast, in turn (still never a circle). */
const SPARE_SHAPES: readonly ShapeId[] = ['galet', 'triangle', 'hexagone', 'capsule', 'squircle', 'goutte', 'nuage']

/** The character for a seat: from the cast by id, else a spare shape by seat index and the id in capitals. */
export function characterFor(playerId: string, seatIndex = 0): Character {
  const known = CAST.find((c) => c.id === playerId)
  if (known) return known
  return { id: playerId, name: playerId.toUpperCase(), shape: SPARE_SHAPES[seatIndex % SPARE_SHAPES.length]!, color: SPARE_COLORS[seatIndex % SPARE_COLORS.length]! }
}
