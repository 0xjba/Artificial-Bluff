import { describe, expect, it } from 'vitest'
import { CAST, characterFor } from '../src/cast'
import { CUES, cueFor, cueLength, cueSignature, JEV_DECIDES, type Moment } from '../src/cues'
import { EXPRESSION_BY_ID } from '../src/engine/expressions'
import { SHAPE_BY_ID } from '../src/engine/skins'
import { STATE_BY_ID } from '../src/engine/states'

describe('cast', () => {
  it('gives the five characters distinct shapes, none of them a circle', () => {
    expect(CAST.map((c) => [c.id, c.name, c.shape])).toEqual([
      ['jev', 'JEV', 'hexagone'],
      ['pill', 'PILL', 'capsule'],
      ['block', 'BLOCK', 'squircle'],
      ['drip', 'DRIP', 'goutte'],
      ['nimbus', 'NIMBUS', 'nuage'],
    ])
    for (const c of CAST) expect(SHAPE_BY_ID.has(c.shape)).toBe(true)
  })

  it('gives unknown seats a spare shape and their id in capitals', () => {
    expect(characterFor('jev')).toBe(CAST[0])
    expect(characterFor('guest', 0)).toEqual({ id: 'guest', name: 'GUEST', shape: 'galet' })
    for (let i = 0; i < 20; i++) expect(characterFor('x', i).shape).not.toBe('cercle')
  })
})

describe('cues', () => {
  it('only uses engine states and faces that exist', () => {
    for (const [moment, cue] of Object.entries(CUES)) {
      for (const beat of [...cue.beats, cue.rest]) {
        expect(STATE_BY_ID.has(beat.state), `${moment}: ${beat.state}`).toBe(true)
        if ('face' in beat && beat.face) expect(EXPRESSION_BY_ID.has(beat.face), `${moment}: ${beat.face}`).toBe(true)
      }
    }
  })

  it('maps game moments as the spec says, with Jev’s comet first when Jev decides', () => {
    const rest = (m: Moment) => CUES[m].rest
    expect(rest('deciding').state).toBe('thinking')
    expect(rest('fold').face).toBe('blase')
    expect(rest('eliminated').state).toBe('sleep')
    expect(rest('fallback').face).toBe('confus')
    expect(CUES.all_in.beats.map((b) => b.state)).toEqual(['exclaim', 'burst'])
    expect(CUES.won.beats.map((b) => b.state)).toEqual(['idle', 'orbit'])
    expect(cueFor('raise', true).beats).toEqual([JEV_DECIDES])
    expect(cueFor('all_in', true).beats.map((b) => b.state)).toEqual(['comet', 'exclaim', 'burst'])
    expect(cueLength(cueFor('all_in', true))).toBeCloseTo(2.4 + 1.2 + 2.6, 9)
    // Stable objects, so a component keyed on the cue doesn't replay on every render.
    expect(cueFor('raise', true)).toBe(cueFor('raise', true))
    expect(cueSignature(cueFor('raise', true))).not.toBe(cueSignature(cueFor('raise')))
  })
})
