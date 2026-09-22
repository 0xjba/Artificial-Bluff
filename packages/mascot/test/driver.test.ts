import { describe, expect, it } from 'vitest'
import { cueFor } from '../src/cues'
import { MascotDriver } from '../src/driver'

describe('MascotDriver', () => {
  it('switches beats at their exact times, then rests', () => {
    const d = new MascotDriver('hexagone', cueFor('all_in', true), 10)
    const at = (t: number) => (d.frame(t), d.state)
    expect(at(10)).toBe('comet')
    expect(at(12.39)).toBe('comet')
    expect(at(12.4)).toBe('exclaim')
    expect(at(13.6)).toBe('burst')
    expect(at(16.2)).toBe('idle') // rest
    expect(at(30)).toBe('idle')
  })

  it('applies every beat it skipped over when frames are far apart', () => {
    const d = new MascotDriver('capsule', cueFor('won'), 0)
    d.frame(100)
    expect(d.state).toBe('idle')
  })

  it('replays from the current pose when given a new cue', () => {
    const d = new MascotDriver('squircle', cueFor('waiting'), 0)
    d.frame(5)
    d.play(cueFor('all_in'), 5)
    expect((d.frame(5.1), d.state)).toBe('exclaim')
  })

  it('is deterministic: the same times give the same frames', () => {
    const run = () => {
      const d = new MascotDriver('goutte', cueFor('won'), 0)
      return [0, 0.5, 1.3, 2.5, 4.7, 6].map((t) => d.frame(t).bodyPath)
    }
    expect(run()).toEqual(run())
  })

  it('keeps each player’s shape in the win animation', () => {
    const orbitAt = (shape: 'hexagone' | 'capsule') => {
      const d = new MascotDriver(shape, cueFor('won'), 0)
      return d.frame(2).bodyPath // 1.2 s of laughing, then 0.8 s into the orbit
    }
    expect(orbitAt('hexagone')).not.toBe(orbitAt('capsule'))
  })

  // Frames also carry the engine's always-on life (breathing, drift) on absolute time, so these compare
  // the body's size (how far it reaches), which is what the beat decides.
  it('restarts a one-shot that is already showing (a second comet starts over)', () => {
    const d = new MascotDriver('hexagone', cueFor('raise', true), 0)
    d.frame(1)
    d.play(cueFor('raise', true), 1) // Jev decides again 1 s into its comet
    const replayed = extent(d.frame(1.1).bodyPath)
    const fresh = extent(new MascotDriver('hexagone', cueFor('raise', true), 0).frame(0.1).bodyPath)
    const continued = extent(new MascotDriver('hexagone', cueFor('raise', true), 0).frame(1.1).bodyPath)
    expect(Math.abs(replayed - fresh)).toBeLessThan(fresh * 0.05)
    expect(continued).toBeLessThan(fresh * 0.5) // carrying on would have shown the collapsed dot
  })

  it('starts its first state at the time it is given', () => {
    const later = extent(new MascotDriver('capsule', cueFor('all_in'), 5).frame(5.5).bodyPath)
    const now = extent(new MascotDriver('capsule', cueFor('all_in'), 0).frame(0.5).bodyPath)
    const wrong = extent(new MascotDriver('capsule', cueFor('all_in'), 0).frame(5.5).bodyPath)
    expect(Math.abs(later - now)).toBeLessThan(now * 0.05)
    expect(Math.abs(wrong - now)).toBeGreaterThan(now * 0.05)
  })
})

/** How far a body path reaches from the centre (its largest coordinate). */
function extent(path: string): number {
  return Math.max(...(path.match(/-?\d+(\.\d+)?/g) ?? []).map((n) => Math.abs(Number(n))))
}
