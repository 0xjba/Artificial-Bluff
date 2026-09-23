'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { NAV } from '../lib/nav'

export { NAV }

/** Whether a nav link is the current section ("/" only on the home page). */
export const isCurrent = (href: string, path: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`))

/** Three rules, or a cross when the menu is open. */
function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      {open ? <path d="M4 4l8 8M12 4l-8 8" /> : <path d="M2 4h12M2 8h12M2 12h12" />}
    </svg>
  )
}

/**
 * The site's sections, with the current one underlined. On a phone there is no room for five links
 * beside the logo and the programme's state, so they fold into a menu that drops out of the header.
 */
export function SiteNav() {
  const path = usePathname() ?? '/'
  const [open, setOpen] = useState(false)
  // Following a link closes the menu; so does Escape, for anyone on a keyboard.
  useEffect(() => setOpen(false), [path])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button type="button" className="menu" aria-expanded={open} aria-controls="site-nav" aria-label={open ? 'close menu' : 'open menu'} onClick={() => setOpen((o) => !o)}>
        <MenuIcon open={open} />
      </button>
      <nav id="site-nav" aria-label="site" className={open ? 'open' : ''}>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} {...(isCurrent(n.href, path) ? { 'aria-current': 'page' as const } : {})}>
            {n.label}
          </Link>
        ))}
      </nav>
    </>
  )
}
