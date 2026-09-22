import { EventStore } from '@ab/core'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ServerConfig } from './config'
import { Director } from './director'
import { createHttpServer } from './http'
import { Hub } from './hub'
import { LiveController } from './live'
import type { LivePlayers } from './players'
import { acquireServerLock } from './lock'
import { replayQueue, type ReplayCache } from './replay'

export interface App {
  server: Server
  hub: Hub
  live: LiveController
  director: Director
  store: EventStore
  /** Where it is listening. */
  url: string
  /** Stops accepting spectators, stops the live game after its hand, and closes everything. */
  close: () => Promise<void>
}

/** Wires the store, hub, live table, director and HTTP API together and starts listening. */
export async function startApp(config: ServerConfig, players: LivePlayers, log: (line: string) => void = console.log): Promise<App> {
  if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true })
  const release = acquireServerLock(config.dbPath)
  const store = new EventStore(config.dbPath)
  // Only live games: a study in the same database may be running in another process.
  const interrupted = store.interruptRunningGames(Date.now(), 'live')
  if (interrupted.length) log(`marked ${interrupted.length} live game(s) left running by a crash as interrupted: ${interrupted.join(', ')}`)

  const hub = new Hub()
  const live = new LiveController({
    store,
    hub,
    makePlayers: players.make,
    budgetUsd: config.liveBudgetUsd,
    paceMs: config.paceMs,
    decisionTimeoutMs: config.decisionTimeoutMs,
    meta: { lineup: players.specs, mock: config.mock },
    log,
  })
  const replays: ReplayCache = new Map()
  const director = new Director({ hub, live, queue: () => replayQueue(store, {}, replays), replayPaceMs: config.replayPaceMs, cooldownMs: config.cooldownMs, log })
  const server = createHttpServer({ config, hub, store, live, log })
  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve))
  director.start()
  const { port } = server.address() as AddressInfo
  const url = `http://${config.host}:${port}`

  let closing: Promise<void> | null = null
  const close = () =>
    (closing ??= (async () => {
      live.stop()
      await director.stop()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
      await live.idle()
      store.close()
      release()
    })())
  return { server, hub, live, director, store, url, close }
}
