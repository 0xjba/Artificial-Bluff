import Link from 'next/link'
import { NAV } from '../lib/nav'

/**
 * The foot of every page: what the site is, in the design's own line (it drew this on Research), the
 * sections again for whoever scrolled to the end, and who made it.
 */
export function SiteFooter() {
  return (
    <footer className="site">
      <div className="foot-brand">
        <Link href="/" className="logo">
          ARTIFICIAL<span>BLUFF</span>
        </Link>
        <p>A research benchmark that happens to be watchable. Chips are play money; models spend real tokens.</p>
      </div>
      <nav aria-label="site, again">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href}>
            {n.label}
          </Link>
        ))}
      </nav>
      <p className="foot-by">
        By <Link href="/research">Jobin Ayathil</Link> · <a href="https://github.com/0xjba">GitHub</a>
      </p>
    </footer>
  )
}
