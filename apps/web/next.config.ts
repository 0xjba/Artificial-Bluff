import type { NextConfig } from 'next'

const api = process.env.API_URL ?? 'http://127.0.0.1:8787'

const nextConfig: NextConfig = {
  // The spectator feed and game data come from the live server (pnpm live); same-origin for the browser.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }]
  },
}

export default nextConfig
