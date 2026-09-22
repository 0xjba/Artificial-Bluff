import type { NextConfig } from 'next'

// Read at BUILD time: rewrites are compiled into the build, so set API_URL when running `next build`.
const api = process.env.API_URL ?? 'http://127.0.0.1:8787'

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
