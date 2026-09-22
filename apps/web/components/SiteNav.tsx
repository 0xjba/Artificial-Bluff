'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export const NAV = [
  { href: '/', label: 'Live' },
  { href: '/replays', label: 'Replays' },
  { href: '/models', label: 'Models' },
  { href: '/research', label: 'Research' },
  { href: '/play', label: 'Run a table' },
] as const

/** Whether a nav link is the current section ("/" only on the home page). */
export const isCurrent = (href: string, path: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`))

/** The site's sections, with the current one underlined. */
export function SiteNav() {
  const path = usePathname() ?? '/'
  return (
    <nav aria-label="site">
      {NAV.map((n) => (
        <Link key={n.href} href={n.href} {...(isCurrent(n.href, path) ? { 'aria-current': 'page' as const } : {})}>
          {n.label}
        </Link>
      ))}
    </nav>
  )
}
