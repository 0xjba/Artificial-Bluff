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
})
