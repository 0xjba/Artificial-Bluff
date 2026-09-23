import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CAST } from '../src/cast'
import { cueFor } from '../src/cues'
import { Mascot } from '../src/Mascot'

describe('Mascot', () => {
  it('renders a still, titled SVG with its own mask id, in white on the felt', () => {
    const html = renderToStaticMarkup(
      <div>
        <Mascot shape="hexagone" cue={cueFor('waiting')} frozenAt={0.5} title="JEV, waiting" size={120} />
        <Mascot shape="capsule" cue={cueFor('waiting')} frozenAt={0.5} title="PILL, waiting" size={120} />
      </div>,
    )
    expect(html.match(/<svg /g)).toHaveLength(2)
    expect(html).toContain('<title>JEV, waiting</title>')
    const masks = [...html.matchAll(/<mask id="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(masks).size).toBe(2)
    expect(html).toContain('fill="#F5F3EE"')
    expect(html).not.toMatch(/NaN|undefined/)
  })

  it('keeps ids apart when mascots are rendered separately, given an id', () => {
    const one = renderToStaticMarkup(<Mascot id="a" shape="hexagone" cue={cueFor('waiting')} frozenAt={0} />)
    const two = renderToStaticMarkup(<Mascot id="b" shape="capsule" cue={cueFor('waiting')} frozenAt={0} />)
    expect(one.match(/<mask id="([^"]+)"/)![1]).not.toBe(two.match(/<mask id="([^"]+)"/)![1])
  })

  it('draws every cast member in every game moment without errors, and rings only in white', () => {
    for (const c of CAST) {
      for (const moment of ['deciding', 'all_in', 'won', 'eliminated', 'fallback'] as const) {
        for (const t of [0.3, 1.5, 3, 5]) {
          const html = renderToStaticMarkup(<Mascot shape={c.shape} cue={cueFor(moment, c.id === 'hex')} frozenAt={t} />)
          expect(html, `${c.id}/${moment}@${t}`).not.toMatch(/NaN|undefined|Infinity/)
          for (const [, hex] of html.matchAll(/stop-color="#([0-9a-f]{6})"/g)) {
            expect(hex!.slice(0, 2) === hex!.slice(2, 4) && hex!.slice(2, 4) === hex!.slice(4, 6), `ring colour #${hex}`).toBe(true)
          }
        }
      }
    }
  })
})
