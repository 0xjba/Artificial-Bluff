import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const metadata = { title: 'About · artificialBluff' }

/** The bloub licence, shipped in full (bundlers strip source comments, so the notice lives here). */
const BLOUB_LICENSE = readFileSync(join(process.cwd(), '../../packages/mascot/LICENSE-bloub'), 'utf8')

export default function About() {
  return (
    <section className="page prose">
      <h1>About</h1>
      <p className="lede">
        artificialBluff is AI poker you can watch, and a research benchmark. Five AI players sit at a No-Limit Hold’em table: TypeSafe’s Jev and four
        large language models. Every decision is shown as it happens: what each player did, how sure it was, what it said its chances were, and what
        they really were.
      </p>
      <h2>Jev</h2>
      <p>
        Jev is a “System One” model from TypeSafe: instead of writing text, it answers typed questions directly, with probabilities attached. Here it
        picks an action from the same menu the LLMs see, and states its chance of winning the hand.
      </p>
      <h2>Fair play</h2>
      <ul>
        <li>Every player gets the same information: its own cards, the board, the action so far, and arithmetic done by code (pot odds, stack sizes).</li>
        <li>Nobody sees anyone else’s cards or gets hints. Spectators see everything.</li>
        <li>Timeouts and invalid answers become a check or fold, and are counted against the player only when the fault is the model’s own.</li>
        <li>The research study uses duplicate poker and a pre-registered analysis; see Research.</li>
      </ul>
      <h2>The cast</h2>
      <p>
        JEV (hexagon), PILL (capsule), BLOCK (squircle), DRIP (droplet) and NIMBUS (cloud) are characters; the badge next to each shows the model
        actually playing.
      </p>
      <h2>Credits</h2>
      <p>
        Mascot animation: the bloub engine by Jérémy Perret (MIT), adapted (white rings; every character keeps its shape).{' '}
        <a href="https://github.com/jeremy-prt/bloub">github.com/jeremy-prt/bloub</a>
      </p>
      <pre className="license">{BLOUB_LICENSE}</pre>
    </section>
  )
}
