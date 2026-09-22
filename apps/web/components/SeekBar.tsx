'use client'

export interface SeekBarProps {
  /** Events in the programme so far. */
  total: number
  /** Events shown now (equals `total` when watching live). */
  pos: number
  /** Positions where each hand starts, for the ticks. */
  starts: number[]
  /** Hand number showing now, and how many there are. */
  hand: { at: number; of: number }
  behind: boolean
  playing: boolean
  onSeek: (pos: number) => void
  onPrevHand: () => void
  onNextHand: () => void
  onTogglePlay: () => void
}

/** The bar under the table: drag back into the game, step by hand, or play the past on. */
export function SeekBar(props: SeekBarProps) {
  const first = props.starts[0] ?? 1
  const shown = Math.max(first, Math.min(props.pos, props.total))
  const at = (p: number) => `${props.total > first ? ((p - first) / (props.total - first)) * 100 : 100}%`
  return (
    <div className="seek">
      <div className="seek-row">
        <button type="button" title="Previous hand" aria-label="previous hand" onClick={props.onPrevHand}>
          ◀◀
        </button>
        {props.behind ? (
          <button type="button" onClick={props.onTogglePlay}>
            {props.playing ? 'Pause' : 'Play'}
          </button>
        ) : null}
        <button type="button" title="Next hand" aria-label="next hand" disabled={!props.behind} onClick={props.onNextHand}>
          ▶▶
        </button>
        <div className="track">
          <span className="fill" style={{ width: at(shown) }} />
          {props.starts.map((s) => (
            <span key={s} className="tick" style={{ left: at(s) }} />
          ))}
          <input
            type="range"
            aria-label="seek through the game"
            min={first}
            max={props.total}
            value={shown}
            onChange={(e) => props.onSeek(Number(e.target.value))}
          />
        </div>
        <span className="at">{props.hand.of === 0 ? 'DEALING…' : props.behind ? `HAND ${props.hand.at} OF ${props.hand.of}` : `HAND 1 → ${props.hand.of}`}</span>
      </div>
      <p>Drag back to rewatch any hand of this game — the table replays from there.</p>
    </div>
  )
}
