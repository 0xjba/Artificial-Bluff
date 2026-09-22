import { defineConfig } from 'vitest/config'

// Next compiles JSX itself (tsconfig "jsx": "preserve"); tests need esbuild to do it. The end-to-end
// test plays a mock live game, so it gets a generous timeout.
export default defineConfig({ esbuild: { jsx: 'automatic' }, test: { testTimeout: 30_000 } })
