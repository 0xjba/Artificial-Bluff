// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cueFor, cueLength } from '../src/cues'
import { Mascot, stillFrame } from '../src/Mascot'
import { MascotSvg } from '../src/MascotSvg'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement
const mount = (el: React.ReactElement) => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(el))
}
const update = (el: React.ReactElement) => act(() => root!.render(el))
const body = () => host.querySelector('mask path')!.getAttribute('d')
const eyes = () => [...host.querySelectorAll('mask path')].slice(1).map((p) => p.getAttribute('transform')).join('|')

function prefersReducedMotion(reduced: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduced && q.includes('reduce'), addEventListener: () => {}, removeEventListener: () => {} }))
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.unstubAllGlobals()
})

describe('Mascot in the browser', () => {
  it('under reduced motion shows the resting pose of each new cue', () => {
    prefersReducedMotion(true)
    mount(<Mascot shape="capsule" cue={cueFor('waiting')} />)
    const waiting = eyes()
    update(<Mascot shape="capsule" cue={cueFor('fold')} />)
    expect(eyes()).not.toBe(waiting)
    const expected = renderToStaticMarkup(<MascotSvg frame={stillFrame('capsule', cueFor('fold'), cueLength(cueFor('fold')) + 1)} uid="x" size={160} />)
    expect(expected).toContain(body()!)
    update(<Mascot shape="squircle" cue={cueFor('fold')} />)
    expect(expected).not.toContain(body()!) // a new shape redraws too
  })

  it('redraws a frozen mascot when its cue changes', () => {
    prefersReducedMotion(false)
    mount(<Mascot shape="hexagone" cue={cueFor('waiting')} frozenAt={0.5} />)
    const before = body()
    update(<Mascot shape="hexagone" cue={cueFor('all_in')} frozenAt={0.5} />)
    expect(body()).not.toBe(before) // the "!" of exclaim, not the hexagon
  })

  it('animates otherwise, and stops its frame loop when removed', () => {
    prefersReducedMotion(false)
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    mount(<Mascot shape="goutte" cue={cueFor('deciding')} title="DRIP, deciding" />)
    expect(host.querySelector('svg')!.getAttribute('aria-label')).toBe('DRIP, deciding')
    act(() => root!.unmount())
    root = null
    expect(cancel).toHaveBeenCalled()
  })
})
