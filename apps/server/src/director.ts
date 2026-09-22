import type { Hub } from './hub'
import type { LiveController } from './live'
import { playReplay, type ReplayItem } from './replay'
import { sleep as realSleep, type Sleep } from './sleep'

export interface DirectorDeps {
  hub: Hub
  live: LiveController
  /** Replays to show when idle (read fresh each round, so new games join the rotation). */
  queue: () => ReplayItem[]
  replayPaceMs: number
  /** How long a finished live game's result stays up before replays resume. */
  cooldownMs: number
  /** How long to wait before looking again when there is nothing to replay. */
  emptyWaitMs?: number
  sleep?: Sleep
}

/**
 * Decides what spectators see: the live game while one runs; otherwise replays in rotation. Starting a
 * live game interrupts the replay at once; after it ends, its result stays up for the cooldown.
 */
export class Director {
  private stopped = new AbortController()
  private interrupt = new AbortController()
  private running: Promise<void> | null = null

  constructor(private readonly deps: DirectorDeps) {
    deps.live.onChange((state) => {
      if (state === 'live') this.interrupt.abort()
    })
  }

  start(): void {
    this.running ??= this.loop()
  }

  /** Stops the rotation (for shutdown); resolves when the loop has exited. */
  async stop(): Promise<void> {
    this.stopped.abort()
    this.interrupt.abort()
    await this.running
  }

  private async loop(): Promise<void> {
    const wait = this.deps.sleep ?? realSleep
    while (!this.stopped.signal.aborted) {
      if (this.deps.live.gameId) {
        await this.deps.live.idle()
        if (this.stopped.signal.aborted) break
        await wait(this.deps.cooldownMs, this.stopped.signal)
        continue
      }
      this.interrupt = new AbortController()
      const items = this.deps.queue()
      if (items.length === 0) {
        if (!this.deps.live.gameId) this.deps.hub.idle()
        await wait(this.deps.emptyWaitMs ?? 60_000, this.interrupt.signal)
        continue
      }
      for (const item of items) {
        if (this.interrupt.signal.aborted || this.stopped.signal.aborted || this.deps.live.gameId) break
        await playReplay(this.deps.hub, item, { paceMs: this.deps.replayPaceMs, signal: this.interrupt.signal, sleep: wait })
      }
    }
  }
}
