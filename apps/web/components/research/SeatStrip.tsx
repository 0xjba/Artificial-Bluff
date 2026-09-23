import type { ModelsTable } from '@ab/server'
import { characterFor } from '@ab/mascot'
import { MascotBadge } from '../MascotBadge'
import { absPts, shortModel } from '../../lib/format'
import styles from '../../app/research/research.module.css'

/**
 * The five seats, closest to the truth first: the same mascots and model chips as the rest of the
 * site, so the study reads as a report on those players rather than on anonymous rows.
 */
export function SeatStrip({ table }: { table: ModelsTable }) {
  const seats = [...table.seats].sort((a, b) => (a.errorPts ?? 99) - (b.errorPts ?? 99))
  return (
    <div className={styles.seats}>
      {seats.map((s) => {
        const index = table.seats.findIndex((x) => x.playerId === s.playerId)
        const who = characterFor(s.playerId, index)
        return (
          <div className={styles.seat} key={s.playerId}>
            <MascotBadge playerId={s.playerId} index={index} size={30} />
            <div className={styles['seat-who']}>
              <b>{who.name}</b>
              <span className={styles.chip}>{shortModel(s.model)}</span>
            </div>
            <div className={styles['seat-error']}>
              <b>{absPts(s.errorPts)}</b>
              <span>off the true chance</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
