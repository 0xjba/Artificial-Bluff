/**
 * The site's sections. A plain module, not the client nav component, so server components (the footer)
 * can read it: a value exported from a 'use client' file reaches the server as a reference, not an array.
 */
export const NAV = [
  { href: '/', label: 'Live' },
  { href: '/replays', label: 'Replays' },
  { href: '/models', label: 'Models' },
  { href: '/research', label: 'Research' },
  { href: '/play', label: 'Run a table' },
] as const
