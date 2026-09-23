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
  /** A replay is played by the server; the bar still scrubs what has arrived. */
  mode: 'live' | 'replay' | 'idle'
  onSeek: (pos: number) => void
  onPrevHand: () => void
  onNextHand: () => void
  onTogglePlay: () => void
}

/** Two bars, or a triangle: the same button, whichever way it is about to go. */
function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" focusable="false" fill="currentColor">
      {playing ? (
        <>
          <rect x="2.5" y="2" width="2.6" height="8" rx="0.6" />
          <rect x="6.9" y="2" width="2.6" height="8" rx="0.6" />
        </>
      ) : (
        <path d="M3.4 2.2 10 6 3.4 9.8z" />
      )}
    </svg>
  )
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
          <button type="button" className="play" title={props.playing ? 'Pause' : 'Play'} aria-label={props.playing ? 'pause' : 'play'} onClick={props.onTogglePlay}>
            <PlayIcon playing={props.playing} />
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
      <p>
        {props.mode === 'live'
          ? 'Drag back to rewatch any hand of this game — the table replays from there.'
          : 'Drag back to rewatch any hand of this replay — it plays on from there.'}
      </p>
    </div>
  )
}
