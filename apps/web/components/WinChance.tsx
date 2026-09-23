import type { SeatView, TableView } from '@ab/core/view'
import { pct } from '../lib/format'

/**
 * A seat's chance of winning the hand. An estimate is marked with ≈, set in its own lighter mark so it
 * reads as a qualifier beside the number rather than a heavy glyph stuck to it.
 */
export function WinChance({ view, seat, short }: { view: TableView; seat: SeatView; short?: boolean }) {
  // On the felt the pill's bottom bar already says Folded or Out, and the word does not fit beside
  // the label on a phone: there, the line just has nothing to show.
  if (seat.status === 'out') return <>{short ? '–' : 'Out'}</>
  if (seat.status === 'folded') return <>{short ? '–' : 'Folded'}</>
  const e = view.equity?.[seat.playerId]
  if (e === undefined) return <>–</>
  return (
    <>
      {view.equityEstimated ? <i className="approx">≈</i> : null}
      {pct(e)}
    </>
  )
}
