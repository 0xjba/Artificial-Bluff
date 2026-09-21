import type { Card } from './cards'

/** Mulberry32: small, fast, deterministic 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * FNV-1a over the parts, then a final avalanche. Turns any key into a 32-bit seed.
 * Each part is length-prefixed, so ('a:1', 2) and ('a', '1:2') cannot collide.
 * Hashes are 32-bit: callers needing exact uniqueness over many values (hands, seed groups)
 * derive one namespace seed and add a counter to it instead of hashing each value.
 */
export function deriveSeed(...parts: Array<string | number>): number {
  const text = parts.map((p) => `${String(p).length}:${p}`).join('')
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** Fisher–Yates shuffle driven by a seed. Never mutates its input. */
export function shuffle(cards: readonly Card[], seed: number): Card[] {
  const out = [...cards]
  const rand = mulberry32(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}
