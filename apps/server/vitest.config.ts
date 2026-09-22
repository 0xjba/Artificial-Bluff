import { defineConfig } from 'vitest/config'

// The live-game and director tests play whole mock tournaments with real (short) timers; when every
// package runs its tests at once they can exceed vitest's 5 s default without anything being wrong.
export default defineConfig({ test: { testTimeout: 30_000 } })
