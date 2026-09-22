'use client'
import { useEffect, useId, useRef, useState } from 'react'
import type { Cue } from './cues'
import { MascotDriver } from './driver'
import type { BotFrame } from './engine/engine'
import type { ShapeId } from './engine/skins'
import { FELT, MASCOT_WHITE, MascotSvg } from './MascotSvg'

export interface MascotProps {
  shape: ShapeId
  cue: Cue
  /** Replays the cue whenever this changes (e.g. `${handId}:${decisionCount}`); defaults to the cue itself. */
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

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/**
 * An animated mascot. It plays `cue` (beats, then the rest pose) and replays it whenever `cueKey`
 * changes, blending from whatever is on screen. With `frozenAt`, or when the viewer prefers reduced
 * motion, it draws a single still frame (server rendering, previews, accessibility).
 */
export function Mascot({ shape, cue, cueKey, size = 160, ink = MASCOT_WHITE, paper = FELT, title, frozenAt, id }: MascotProps) {
  const reactId = useId()
  const uid = `m${(id ?? reactId).replace(/[^A-Za-z0-9_-]/g, '')}`
  const driver = useRef<MascotDriver | null>(null)
  const clock = useRef<{ origin: number } | null>(null)
  const [frame, setFrame] = useState<BotFrame>(() => {
    const d = new MascotDriver(shape, cue, 0)
    driver.current = d
    return d.frame(frozenAt ?? 0)
  })
  const key = cueKey ?? cue

  // A new cue (or the same cue under a new key) starts from the current time.
  useEffect(() => {
    const d = driver.current
    if (!d || frozenAt !== undefined) return
    const now = clock.current ? (performance.now() - clock.current.origin) / 1000 : 0
    d.play(cue, now)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    const d = driver.current
    if (!d) return
    const now = clock.current ? (performance.now() - clock.current.origin) / 1000 : 0
    d.setShape(shape, now)
  }, [shape])

  useEffect(() => {
    const d = driver.current
    if (!d) return
    if (frozenAt !== undefined || reducedMotion()) {
      setFrame(d.frame(frozenAt ?? 0))
      return
    }
    clock.current ??= { origin: performance.now() }
    let raf = 0
    const tick = () => {
      setFrame(d.frame((performance.now() - clock.current!.origin) / 1000))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [frozenAt])

  return <MascotSvg frame={frame} uid={uid} size={size} ink={ink} paper={paper} {...(title ? { title } : {})} />
}
