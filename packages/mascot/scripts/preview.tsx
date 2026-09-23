/**
 * Writes a static preview sheet of the mascots (still frames, no scripts) for the brand docs. Each
 * mascot is rendered separately, so each gets an explicit `id` (see MascotProps.id).
 *   pnpm --filter @ab/mascot preview [out.html]   (default: docs/brand/mascots.html at the repo root)
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { CAST } from '../src/cast'
import { cueFor, type Moment } from '../src/cues'
import { Mascot } from '../src/Mascot'
import { FELT } from '../src/MascotSvg'

const PANEL = '#0E3029'
const moments: Array<{ moment: Moment; label: string; at: number }> = [
  { moment: 'deciding', label: 'deciding', at: 1.2 },
  { moment: 'check_call', label: 'check / call', at: 1 },
  { moment: 'raise', label: 'raise', at: 1 },
  { moment: 'all_in', label: 'all-in', at: 1.7 },
  { moment: 'fold', label: 'fold', at: 1 },
  { moment: 'won', label: 'wins the pot', at: 2.4 },
  { moment: 'lost_big', label: 'loses big', at: 1 },
  { moment: 'fallback', label: 'timeout / fallback', at: 1 },
  { moment: 'eliminated', label: 'eliminated', at: 1.5 },
]

const cast = CAST.map(
  (c) => `<figure><div class="card${c.id === 'hex' ? ' jev' : ''}">${renderToStaticMarkup(
    <Mascot id={`cast-${c.id}`} shape={c.shape} cue={cueFor('waiting')} frozenAt={0.6} size={150} paper={PANEL} title={`${c.name}, waiting`} />,
  )}</div><figcaption><b>${c.name}</b><br>${c.shape}</figcaption></figure>`,
).join('')

const grid = moments
  .map(
    ({ moment, label, at }) =>
      `<tr><th>${label}</th>${CAST.map((c) => `<td>${renderToStaticMarkup(<Mascot id={`${moment}-${c.id}`} shape={c.shape} cue={cueFor(moment)} frozenAt={at} size={96} title={`${c.name}, ${label}`} />)}</td>`).join('')}</tr>`,
  )
  .join('')

const jev = [0.4, 1.0, 1.8, 2.6]
  .map((t) => `<td>${renderToStaticMarkup(<Mascot id={`jev-${String(t).replace('.', '_')}`} shape="hexagone" cue={cueFor('raise', true)} frozenAt={t} size={96} title={`JEV decides, ${t} s`} />)}</td>`)
  .join('')

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>artificialBluff mascots</title>
<style>
body{margin:0;background:${FELT};color:#F3EBDD;font:14px/1.4 Barlow,system-ui,sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px}
h1{font-family:"Barlow Condensed",Barlow,sans-serif;font-size:30px;margin:0 0 4px}h1 span{color:#E8B04A}
h2{font-family:"Barlow Condensed",Barlow,sans-serif;color:#E8B04A;font-size:18px;margin:28px 0 8px}
p{color:#9DB8AE;margin:0 0 16px}
.cast{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
figure{margin:0;text-align:center}figcaption{color:#9DB8AE;font-size:13px;margin-top:6px}figcaption b{color:#F3EBDD;font-size:16px}
.card{background:${PANEL};border:1px solid #1F4A40;border-radius:8px;padding:6px}.card.jev{border:2px solid #E8B04A}
.scroll{overflow-x:auto}table{border-collapse:collapse}th{color:#9DB8AE;font-weight:500;text-align:right;padding-right:10px;white-space:nowrap}td{padding:0}
</style></head><body><main>
<h1>artificial<span>Bluff</span> · the cast</h1>
<p>Neutral white bodies, one distinct shape per seat, kept through every animation. Bloub engine by Jérémy Perret (MIT), adapted.</p>
<div class="cast">${cast}</div>
<h2>GAME MOMENTS</h2>
<div class="scroll"><table>${grid}</table></div>
<h2>JEV DECIDES · the comet, then its reaction</h2>
<div class="scroll"><table><tr><th>0.4 → 2.6 s</th>${jev}</tr></table></div>
</main></body></html>
`
const out = resolve(process.argv[2] ?? '../../docs/brand/mascots.html')
writeFileSync(out, html)
console.log(`wrote ${out}`)
