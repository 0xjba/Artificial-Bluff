import { card } from '../lib/format'

/**
 * Pip positions (in a 0-1 box) for number cards, as on a standard deck: two columns and a centre
 * column. Pips in the lower half are drawn upside down, like printed cards.
 */
const L = 0
const C = 0.5
const R = 1
export const PIPS: Record<string, Array<[number, number]>> = {
  '2': [[C, 0.1], [C, 0.9]],
  '3': [[C, 0.1], [C, 0.5], [C, 0.9]],
  '4': [[L, 0.1], [R, 0.1], [L, 0.9], [R, 0.9]],
  '5': [[L, 0.1], [R, 0.1], [C, 0.5], [L, 0.9], [R, 0.9]],
  '6': [[L, 0.1], [R, 0.1], [L, 0.5], [R, 0.5], [L, 0.9], [R, 0.9]],
  '7': [[L, 0.1], [R, 0.1], [C, 0.3], [L, 0.5], [R, 0.5], [L, 0.9], [R, 0.9]],
  '8': [[L, 0.1], [R, 0.1], [C, 0.3], [L, 0.5], [R, 0.5], [C, 0.7], [L, 0.9], [R, 0.9]],
  '9': [[L, 0.1], [R, 0.1], [L, 0.37], [R, 0.37], [C, 0.5], [L, 0.63], [R, 0.63], [L, 0.9], [R, 0.9]],
  '10': [[L, 0.1], [R, 0.1], [C, 0.24], [L, 0.37], [R, 0.37], [L, 0.63], [R, 0.63], [C, 0.76], [L, 0.9], [R, 0.9]],
}

// Card geometry, in SVG units (a 5:7 poker card).
const W = 100
const H = 140

/**
 * Card colours are set as attributes rather than CSS, so the drawing carries them wherever it is
 * rendered (some renderers drop CSS-driven fills on small, heavily scaled SVGs).
 */
export const CARD_COLORS = { face: '#fbf8f1', edge: '#d8d0c0', ink: '#16211e', red: '#c0392b', back: '#1f5547', backEdge: '#e8b04a' }
/** Where pip centres go: clear of the corner indices. */
const PIP_BOX = { x: 33, y: 16, w: 34, h: 108 }

/**
 * A playing card drawn like a real one: rank and suit in the top-left corner and, upside down, the
 * bottom-right; the standard pip layout for 2-10, one large suit for an ace, and a framed letter for
 * court cards. `small` cards (at the seats) show the rank in the top-left and one large suit in the
 * middle, so both stay readable at that size. `code` null draws the back.
 */
export function PlayingCard({ code, small = false }: { code: string | null; small?: boolean }) {
  const size = small ? { width: 26, height: 36 } : { width: 56, height: 78 }
  if (!code) {
    return (
      <svg className="card back" viewBox={`0 0 ${W} ${H}`} {...size} role="img" aria-label="face-down card">
        <rect x="1" y="1" width={W - 2} height={H - 2} rx="9" className="card-back" fill={CARD_COLORS.back} stroke={CARD_COLORS.face} strokeWidth="4" />
        <rect x="8" y="8" width={W - 16} height={H - 16} rx="5" className="card-back-inner" fill="none" stroke={CARD_COLORS.backEdge} strokeWidth="2" opacity="0.7" />
      </svg>
    )
  }
  const c = card(code)
  const ink = c.red ? CARD_COLORS.red : CARD_COLORS.ink
  // Text presentation: some platforms draw ♥ and ♦ as colour emoji otherwise (ignoring the fill).
  const glyph = `${c.suit}\uFE0E`
  const suitName = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' }[c.suit] ?? c.suit
  const rankName = { A: 'ace', K: 'king', Q: 'queen', J: 'jack' }[c.rank] ?? c.rank
  const pips = PIPS[c.rank]
  const court = c.rank === 'J' || c.rank === 'Q' || c.rank === 'K'
  if (small) {
    // Drawn in its own pixel-sized coordinate space (the art scaled by a group, not by the viewBox):
    // some renderers drop the contents of a heavily scaled viewBox at this size.
    const k = size.width / W
    return (
      <svg className={`card face${c.red ? ' red' : ''} small`} viewBox={`0 0 ${size.width} ${size.height}`} {...size} role="img" aria-label={`${rankName} of ${suitName}`}>
        <g transform={`scale(${k})`} fill={ink}>
          <rect x="1" y="1" width={W - 2} height={H - 2} rx="9" className="card-face" fill={CARD_COLORS.face} stroke={CARD_COLORS.edge} strokeWidth="1.5" />
          <text x="8" y="44" className="corner-rank" fontSize="46" {...(c.rank === '10' ? { textLength: 44, lengthAdjust: 'spacingAndGlyphs' as const } : {})}>
            {c.rank}
          </text>
          <text x={W / 2 + 4} y={H / 2 + 18} textAnchor="middle" dominantBaseline="central" fontSize="80" className="pip">
            {glyph}
          </text>
        </g>
      </svg>
    )
  }
  const ten = c.rank === '10' ? { textLength: 16, lengthAdjust: 'spacingAndGlyphs' } : {}
  const corner = (
    <g className="corner" fill={ink}>
      <text x="7" y="25" className="corner-rank" fontSize="21" {...ten}>
        {c.rank}
      </text>
      <text x="8" y="42" className="corner-suit" fontSize="16">
        {glyph}
      </text>
    </g>
  )
  return (
    <svg className={`card face${c.red ? ' red' : ''}`} viewBox={`0 0 ${W} ${H}`} {...size} role="img" aria-label={`${rankName} of ${suitName}`} fill={ink}>
      <rect x="1" y="1" width={W - 2} height={H - 2} rx="9" className="card-face" fill={CARD_COLORS.face} stroke={CARD_COLORS.edge} strokeWidth="1.5" />
      {corner}
      <g transform={`rotate(180 ${W / 2} ${H / 2})`}>{corner}</g>
      {court ? (
        <g>
          <rect x="30" y="18" width="40" height="104" rx="4" className="court-frame" fill="none" stroke={ink} strokeWidth="1.5" opacity="0.35" />
          <text x={W / 2} y={H / 2 - 4} textAnchor="middle" dominantBaseline="central" fontSize="40" className="court-rank">
            {c.rank}
          </text>
          <text x={W / 2} y={H / 2 + 30} textAnchor="middle" dominantBaseline="central" fontSize="22" className="pip">
            {glyph}
          </text>
        </g>
      ) : c.rank === 'A' ? (
        <text x={W / 2} y={H / 2} textAnchor="middle" dominantBaseline="central" fontSize="56" className="pip">
          {glyph}
        </text>
      ) : (
        pips?.map(([px, py], i) => {
          const x = PIP_BOX.x + px * PIP_BOX.w
          const y = PIP_BOX.y + py * PIP_BOX.h
          return (
            <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="21" className="pip" transform={py > 0.5 ? `rotate(180 ${x} ${y})` : undefined}>
              {glyph}
            </text>
          )
        })
      )}
    </svg>
  )
}

/**
 * A card as it arrives on the felt: pitched in face down, then turned over, `delay` ms after it
 * mounts (so a round of cards goes out in order). The back is drawn behind the face, so the turn is
 * a real flip. `won` lifts it when its seat takes the pot.
 */
export function DealtCard({ code, small = false, delay = 0, won = false }: { code: string; small?: boolean; delay?: number; won?: boolean }) {
  return (
    <span className={`deal${small ? ' small' : ''}${won ? ' won' : ''}`} style={{ '--deal-delay': `${delay}ms` } as React.CSSProperties}>
      <PlayingCard code={code} small={small} />
    </span>
  )
}

/** A folded hand: both cards face down, tossed towards the middle and left there, dimmed. */
export function MuckedCards() {
  return (
    <span className="muck" aria-label="folded">
      <PlayingCard code={null} small />
      <PlayingCard code={null} small />
    </span>
  )
}
