import type { SeatView, TableView } from '@ab/core/view'
import { pct } from '../lib/format'

/**
 * A seat's chance of winning the hand. An estimate is marked with ≈, set in its own lighter mark so it
 * reads as a qualifier beside the number rather than a heavy glyph stuck to it.
 */
export function WinChance({ view, seat }: { view: TableView; seat: SeatView }) {
  if (seat.status === 'out') return <>Out</>
  if (seat.status === 'folded') return <>Folded</>
  const e = view.equity?.[seat.playerId]
  if (e === undefined) return <>–</>
  return (
    <>
      {view.equityEstimated ? <i className="approx">≈</i> : null}
      {pct(e)}
    </>
  )
}
