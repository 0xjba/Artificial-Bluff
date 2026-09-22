import type { BotFrame } from './engine/engine'
import { NOTIF_BLUE } from './engine/decor'
import { DEMI_VIEWBOX, RAYON } from './engine/repere'
import { mixHex } from './engine/skins'

/** Brand colours: every mascot is neutral white on the felt (spec §8). */
export const MASCOT_WHITE = '#F5F3EE'
export const FELT = '#0B2A24'

export interface MascotSvgProps {
  frame: BotFrame
  /** Unique per mascot on the page (mask and gradient ids). */
  uid: string
  size: number
  /** Body colour. */
  ink?: string
  /** What is behind the mascot: seen through the eyes. */
  paper?: string
  /** Accessible name, e.g. "JEV, thinking". */
  title?: string
}

/**
 * Draws one engine frame (port of the bloub Vue component's template). The eyes are holes cut in the
 * body with a mask, so they clip themselves at the silhouette's edge; the back halves of rings and the
 * burst particles are drawn behind the body.
 */
export function MascotSvg({ frame, uid, size, ink = MASCOT_WHITE, paper = FELT, title }: MascotSvgProps) {
  const VB = DEMI_VIEWBOX
  const maskId = `${uid}-mask`
  const dot = (d: BotFrame['dots'][number], key: string) => {
    const fill = d.color ?? (d.depth === undefined ? ink : mixHex(paper, ink, d.depth))
    return d.d ? (
      <path key={key} d={d.d} fill={fill} opacity={d.opacity} transform={`translate(${d.x} ${d.y}) rotate(${d.rot ?? 0}) scale(${RAYON})`} />
    ) : (
      <circle key={key} cx={d.x} cy={d.y} r={d.r} fill={fill} opacity={d.opacity} />
    )
  }
  return (
    <svg width={size} height={size} viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`} role="img" aria-label={title}>
      {title ? <title>{title}</title> : null}
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x={-VB} y={-VB} width={VB * 2} height={VB * 2}>
          <path d={frame.bodyPath} fill="#fff" />
          {frame.eyes.map((eye, i) => (
            <path key={i} d={eye.d} transform={eye.matrix} opacity={eye.alpha} fill="#000" />
          ))}
          {frame.notch ? <circle cx={frame.notch.x} cy={frame.notch.y} r={frame.notch.r} fill="#000" /> : null}
        </mask>
        {frame.arcs.map((arc) => (
          <linearGradient key={arc.id} id={`${uid}-${arc.id}`} gradientUnits="userSpaceOnUse" x1={arc.grad.x1} y1={arc.grad.y1} x2={arc.grad.x2} y2={arc.grad.y2}>
            {arc.grad.stops.map((c, i) => (
              <stop key={i} offset={i / (arc.grad.stops.length - 1)} stopColor={c} />
            ))}
          </linearGradient>
        ))}
      </defs>
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => (
          <path key={`b${arc.id}`} d={arc.back} stroke={`url(#${uid}-${arc.id})`} strokeWidth={arc.width} opacity={arc.opacity} />
        ))}
      </g>
      {frame.dotsBehind ? <g>{frame.dots.map((d, i) => dot(d, `pb${i}`))}</g> : null}
      <g opacity={frame.bodyAlpha}>
        <path d={frame.bodyPath} fill={paper} />
        <g mask={`url(#${maskId})`}>
          <rect x={-VB} y={-VB} width={VB * 2} height={VB * 2} fill={ink} />
        </g>
      </g>
      {!frame.dotsBehind ? <g>{frame.dots.map((d, i) => dot(d, `pf${i}`))}</g> : null}
      {frame.notif ? <circle cx={frame.notif.x} cy={frame.notif.y} r={frame.notif.r} fill={NOTIF_BLUE} /> : null}
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => (
          <path key={`f${arc.id}`} d={arc.front} stroke={`url(#${uid}-${arc.id})`} strokeWidth={arc.width} opacity={arc.opacity} />
        ))}
      </g>
    </svg>
  )
}
