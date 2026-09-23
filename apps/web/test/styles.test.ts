import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WEB = join(__dirname, '..')
const classNames = (css: string) => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return new Set([...withoutComments.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]!))
}

/**
 * The shared stylesheet may only style the shell and the broadcast screen. Anything a single page
 * needs belongs in that page's CSS module, where the class name is hashed and cannot collide: twice
 * a page added a name the table already used ('.card', then '.board') and blanked the cards.
 */
const SHARED = new Set([
  // base and utilities
  'muted', 'warn', 'yes', 'sr-only', 'page', 'lede', 'scroll', 'badge', 'license', 'games', 'study', 'n', 'jev',
  // the shell: header, nav, status
  'site', 'site-status', 'logo', 'tag', 'live', 'replay', 'behind', 'blip', 'mute', 'research-light', 'menu', 'open', 'part', 'extra', 'watch-live',
  // the broadcast screen, shared by the live table, replays and a browser table
  'broadcast', 'programme', 'controls', 'progress', 'new-here', 'label', 'how', 'dismiss',
  'stage-grid', 'stage', 'side', 'felt', 'centre', 'centre-line', 'pot', 'board', 'seat-slot',
  'players', 'player', 'player-top', 'player-id', 'player-stack', 'player-win', 'player-stats', 'acting', 'dim', 'up', 'down', 'bar',
  'seat-card', 'seat-face', 'seat-id', 'seat-stack', 'seat-cards', 'seat-act', 'seat-win', 'stack', 'dealer', 'now', 'quiet',
  'decision', 'claims', 'who-did', 'action', 'true', 'reasoning', 'probs', 'chosen', 'value', 'approx',
  'log', 'hand-head', 'at', 'what', 'all-hands', 'end', 'win', 'split', 'fold', 'raise', 'allin', 'flop', 'turn', 'river',
  'seek', 'seek-row', 'track', 'fill', 'tick', 'title', 'play',
  // playing cards
  'card', 'slot', 'gone',
])

describe('stylesheets', () => {
  it('keeps page styles out of the shared stylesheet', () => {
    const globals = classNames(readFileSync(join(WEB, 'app/globals.css'), 'utf8'))
    const strays = [...globals].filter((c) => !SHARED.has(c)).sort()
    expect(strays, 'put page-only styles in that page\'s .module.css, where the name is hashed').toEqual([])
  })

  it('gives every page its own module', () => {
    const modules = [
      'app/models/models.module.css',
      'app/replays/replays.module.css',
      'app/research/research.module.css',
      'components/play/run.module.css',
    ]
    for (const m of modules) expect(readFileSync(join(WEB, m), 'utf8').length).toBeGreaterThan(100)
  })

  it('defines every class its pages ask for', () => {
    // styles.whatever is undefined when the module has no such class, and React then writes
    // class="undefined": the element renders unstyled, which is how a section heading and a page's
    // kicker went plain after the move into modules.
    const files = readdirSync(WEB, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.tsx') && !f.startsWith('node_modules') && !f.startsWith('.next'))
      .map((f) => join(WEB, f))
    const dangling: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      const imported = /import styles from '([^']+\.module\.css)'/.exec(src)
      if (!imported) continue
      const defined = classNames(readFileSync(join(dirname(file), imported[1]!), 'utf8'))
      const used = [
        ...[...src.matchAll(/styles\.([a-zA-Z]\w*)/g)].map((m) => m[1]!),
        ...[...src.matchAll(/styles\['([^']+)'\]/g)].map((m) => m[1]!),
      ]
      for (const name of used) if (!defined.has(name)) dangling.push(`${file.slice(WEB.length + 1)}: .${name}`)
    }
    expect(dangling.sort()).toEqual([])
  })

  it('keeps one table at every width', () => {
    // The felt is restated for narrow screens, where it takes the column's width. Its proportions and
    // its capsule shape must not drift with it: a 50% radius turns the same table into an egg.
    const css = readFileSync(join(WEB, 'app/globals.css'), 'utf8')
    const felts = [...css.matchAll(/\.felt\s*\{([^}]*)\}/g)].map((m) => m[1]!)
    expect(felts.length).toBeGreaterThan(1)
    for (const rule of felts) {
      const ratio = /aspect-ratio:\s*([^;]+);/.exec(rule)?.[1]?.trim()
      if (ratio) expect(ratio).toBe('404 / 610')
      const radius = /border-radius:\s*([^;]+);/.exec(rule)?.[1]?.trim()
      // Half the width or more: round caps with straight sides, never a percentage (an ellipse).
      if (radius) expect(radius).toMatch(/^\d+px$/)
    }
  })

  it('never lets a page module style a class the table uses', () => {
    // Modules are hashed, so this can only bite through :global(...) escapes.
    const modules = readdirSync(join(WEB, 'app'), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.module.css'))
      .map((f) => join(WEB, 'app', f))
      .concat([join(WEB, 'components/play/run.module.css')])
    for (const file of modules) {
      const globalEscapes = [...readFileSync(file, 'utf8').matchAll(/:global\(([^)]*)\)/g)].map((m) => m[1]!)
      expect(globalEscapes, `${file} reaches outside its page`).toEqual([])
    }
  })
})
