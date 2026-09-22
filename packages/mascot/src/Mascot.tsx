'use client'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { cueLength, cueSignature, type Cue } from './cues'
import { MascotDriver } from './driver'
import type { BotFrame } from './engine/engine'
import type { ShapeId } from './engine/skins'
import { FELT, MASCOT_WHITE, MascotSvg } from './MascotSvg'

export interface MascotProps {
  shape: ShapeId
  cue: Cue
  /** Replays the cue whenever this changes (e.g. `${handId}:${decisionCount}`); defaults to the cue's content. */
  cueKey?: string
  size?: number
  ink?: string
  paper?: string
  title?: string
  /** Draw one still frame at this time (seconds into the cue) instead of animating. */
  frozenAt?: number
  /**
   * Prefix for the SVG's mask and gradient ids. Needed only when mascots are rendered in separate
   * React trees onto one page (each tree restarts useId, so ids would collide and every body would be
   * drawn through the first mascot's mask).
   */
  id?: string
}

/** Whether the viewer asks for reduced motion, following changes (false while rendering on the server). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined
    if (!query) return
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])
  return reduced
}

/** One still frame of a cue at `t` seconds, from a fresh driver (pure: same inputs, same frame). */
export function stillFrame(shape: ShapeId, cue: Cue, t: number): BotFrame {
  return new MascotDriver(shape, cue, 0).frame(t)
}

/**
 * An animated mascot. It plays `cue` (beats, then the rest pose) and replays it whenever `cueKey`
 * changes, blending from whatever is on screen. With `frozenAt` it draws that still frame; when the
 * viewer prefers reduced motion it draws the cue's resting pose. Still frames are recomputed whenever
 * the shape, cue or key change.
 */
export function Mascot({ shape, cue, cueKey, size = 160, ink = MASCOT_WHITE, paper = FELT, title, frozenAt, id }: MascotProps) {
  const reactId = useId()
  const uid = `m${(id ?? reactId).replace(/[^A-Za-z0-9_-]/g, '')}`
  const key = cueKey ?? cueSignature(cue)
  const reduced = usePrefersReducedMotion()
  const still = frozenAt !== undefined || reduced
  const stillAt = frozenAt ?? cueLength(cue) + 1

  const stillShown = useMemo(() => (still ? stillFrame(shape, cue, stillAt) : null), [still, shape, key, stillAt]) // eslint-disable-line react-hooks/exhaustive-deps

  // Animated path: one driver for the component's life, a clock started on first animation.
  const driver = useRef<MascotDriver | null>(null)
  const origin = useRef<number | null>(null)
  const [animated, setAnimated] = useState<BotFrame>(() => stillFrame(shape, cue, 0))
  const now = () => (origin.current === null ? 0 : (performance.now() - origin.current) / 1000)

  useEffect(() => {
    if (still) return
    origin.current ??= performance.now()
    driver.current ??= new MascotDriver(shape, cue, now())
    const d = driver.current
    let raf = 0
    const tick = () => {
      setAnimated(d.frame(now()))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [still]) // eslint-disable-line react-hooks/exhaustive-deps

  // A new cue (or key), or coming back from a still frame, plays the current cue from now.
  useEffect(() => {
    if (!still) driver.current?.play(cue, now())
  }, [key, still]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!still) driver.current?.setShape(shape, now())
  }, [shape, still]) // eslint-disable-line react-hooks/exhaustive-deps

  return <MascotSvg frame={stillShown ?? animated} uid={uid} size={size} ink={ink} paper={paper} {...(title ? { title } : {})} />
}
