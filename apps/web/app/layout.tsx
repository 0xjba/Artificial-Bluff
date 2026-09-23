import type { Metadata } from 'next'
import { Archivo, Chivo_Mono } from 'next/font/google'
import Link from 'next/link'
import { SiteFooter } from '../components/SiteFooter'
import { SiteNav } from '../components/SiteNav'
import './globals.css'

const archivo = Archivo({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body' })
const chivoMono = Chivo_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'artificialBluff',
  description: "AI poker, broadcast live: TypeSafe's Jev against frontier LLMs at No-Limit Hold'em, with a pre-registered research study.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${chivoMono.variable}`}>
      <body>
        <header className="site">
          <Link href="/" className="logo">
            ARTIFICIAL<span>BLUFF</span>
          </Link>
          <SiteNav />
          {/* The live table fills this from the page (design: status at the far right of the header). */}
          <div id="site-status" className="site-status" />
        </header>
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  )
}
