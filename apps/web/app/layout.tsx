import type { Metadata } from 'next'
import { Barlow, Barlow_Condensed } from 'next/font/google'
import Link from 'next/link'
import './globals.css'

const barlow = Barlow({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-body' })
const condensed = Barlow_Condensed({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-display' })

export const metadata: Metadata = {
  title: 'artificialBluff',
  description: "AI poker, broadcast live: TypeSafe's Jev against frontier LLMs at No-Limit Hold'em, with a pre-registered research study.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlow.variable} ${condensed.variable}`}>
      <body>
        <header className="site">
          <Link href="/" className="logo">
            artificial<span>Bluff</span>
          </Link>
          <nav>
            <Link href="/">Table</Link>
            <Link href="/play">Play</Link>
            <Link href="/replays">Replays</Link>
            <Link href="/research">Research</Link>
            <Link href="/about">About</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  )
}
