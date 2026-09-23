import { networkInterfaces } from 'node:os'
import type { NextConfig } from 'next'

// Read at BUILD time: rewrites are compiled into the build, so set API_URL when running `next build`.
const api = process.env.API_URL ?? 'http://127.0.0.1:8787'

/**
 * This machine's own addresses on the network, so `pnpm dev` can be opened from a phone or another
 * laptop. Next blocks dev requests from an origin it was not told about, and the page then never
 * hydrates: it renders, but nothing connects and the table reads OFF AIR. Dev only; a build ignores it.
 * DEV_ORIGINS adds more (comma-separated), e.g. a hostname or a tunnel.
 */
const devOrigins = [
  ...new Set([
    ...Object.values(networkInterfaces())
      .flat()
      .filter((i) => i !== undefined && i.family === 'IPv4' && !i.internal)
      .map((i) => i!.address),
    ...(process.env.DEV_ORIGINS?.split(',').map((o) => o.trim()) ?? []),
  ]),
].filter(Boolean)

const nextConfig: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: devOrigins,
  // Only the public read API of the live server is proxied (same-origin for the browser); the admin API
  // stays reachable on the server's own port only.
  async rewrites() {
    return [
      { source: '/api/feed', destination: `${api}/api/feed` },
      { source: '/api/state', destination: `${api}/api/state` },
      { source: '/api/health', destination: `${api}/api/health` },
      { source: '/api/games', destination: `${api}/api/games` },
      { source: '/api/games/:path*', destination: `${api}/api/games/:path*` },
    ]
  },
}

export default nextConfig
