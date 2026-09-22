import { equityKey, tableEquity, type TableView } from '@ab/core/browser'
import type { EquitySource } from './feed'

/** Boards kept: a long game seen from end to end, so dragging back never recomputes one. */
export const EQUITY_CACHE = 400

const worked = new Map<string, { equity: Record<string, number>; estimated: boolean } | null>()

/**
 * The true chances, worked out in the browser for programmes nobody sends them for (a replay, and the
 * past of a live game). Dragging the seek bar rebuilds the screen on every frame, so results are kept
 * by board: `tableEquity` is a pure function of what `equityKey` names, and counting every way the
 * cards can fall is the expensive part of the screen.
 */
export const cachedTableEquity: EquitySource = (view: TableView) => {
  const key = equityKey(view)
  if (key === null) return null
  const hit = worked.get(key)
  if (hit !== undefined) return hit
  const value = tableEquity(view)
  if (worked.size >= EQUITY_CACHE) worked.delete(worked.keys().next().value as string)
  worked.set(key, value)
  return value
}
