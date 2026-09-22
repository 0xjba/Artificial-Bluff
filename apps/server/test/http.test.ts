import { EventStore } from '@ab/core'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startApp, type App } from '../src/app'
import { parseServerConfig, type ServerConfig } from '../src/config'
import type { FeedMessage } from '../src/hub'
import { sseWriter } from '../src/http'
import { mockPlayers } from './fixtures'

const TOKEN = 'test-admin-token-0123456789'
const apps: App[] = []

async function app(over: Partial<ServerConfig> = {}): Promise<App> {
  const config: ServerConfig = {
    ...parseServerConfig({}),
    port: 0,
    dbPath: ':memory:',
    adminToken: TOKEN,
    mock: true,
    paceMs: 5,
    decisionTimeoutMs: 1000,
    replayPaceMs: 5,
    cooldownMs: 0,
    ...over,
  }
  const a = await startApp(config, { specs: [], make: mockPlayers }, () => undefined)
  apps.push(a)
  return a
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()))
})

const admin = (a: App, path: string, token = TOKEN) => fetch(`${a.url}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })

/** Reads the SSE feed until `enough` says stop; returns the messages. */
async function readFeed(a: App, enough: (messages: FeedMessage[]) => boolean, ms = 15_000): Promise<FeedMessage[]> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  const res = await fetch(`${a.url}/api/feed`, { signal: ac.signal })
  expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  const messages: FeedMessage[] = []
  let buffer = ''
  try {
    while (!enough(messages)) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let cut: number
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        for (const line of block.split('\n')) if (line.startsWith('data: ')) messages.push(JSON.parse(line.slice(6)) as FeedMessage)
      }
    }
  } finally {
    clearTimeout(timer)
    ac.abort()
  }
  return messages
}

describe('HTTP API', () => {
  it('reports health and state, and answers unknown paths with 404', async () => {
    const a = await app()
    const health = await (await fetch(`${a.url}/api/health`)).json()
    expect(health).toMatchObject({ ok: true, liveGame: null, mock: true })
    const state = await (await fetch(`${a.url}/api/state`)).json()
    expect(state.channel.mode).toBe('idle')
    const missing = await fetch(`${a.url}/api/nope`)
    expect(missing.status).toBe(404)
    expect(missing.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('answers a request target Node accepts but URL rejects with 400, and keeps running', async () => {
    const a = await app()
    const { port } = new URL(a.url)
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = connect(Number(port), '127.0.0.1', () => socket.write('GET //[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'))
      let data = ''
      socket.on('data', (d) => (data += d))
      socket.on('end', () => resolve(data))
      socket.on('error', reject)
    })
    expect(reply).toMatch(/^HTTP\/1\.1 400/)
    expect((await fetch(`${a.url}/api/health`)).status).toBe(200)
  })

  it('disconnects a spectator who falls too far behind', () => {
    let destroyed = false
    const written: string[] = []
    const res = { writableEnded: false, destroyed: false, writableLength: 0, write: (c: string) => written.push(c) > 0, destroy: () => void (destroyed = true) }
    const send = sseWriter(res as never, 1000)
    send({ type: 'equity', channelId: 'c', handId: null, equity: null, estimated: false })
    expect(written).toHaveLength(1)
    res.writableLength = 5000 // the client stopped reading
    expect(() => send({ type: 'equity', channelId: 'c', handId: null, equity: null, estimated: false })).toThrow(/too far behind/)
    expect(destroyed).toBe(true)
  })

  it('serves a finished game in pages', async () => {
    const a = await app()
    const { gameId } = await (await admin(a, '/api/admin/games')).json()
    a.live.stop()
    await a.live.idle()
    const all = a.store.events(gameId)
    const page = await (await fetch(`${a.url}/api/games/${gameId}/events?after=${all.length - 3}`)).json()
    expect(page.events.map((e: { seq: number }) => e.seq)).toEqual(all.slice(-3).map((e) => e.seq))
    expect(page.next).toBeNull()
    expect((await fetch(`${a.url}/api/games/${gameId}/events?after=-1`)).status).toBe(400)
  })

  it('refuses a second server on the same database, and leaves running studies alone', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'ab-app-')), 'live.db')
    const seed = new EventStore(dbPath)
    seed.createGame('crashed-live', 'live', {})
    seed.createGame('study-in-progress', 'study', {})
    seed.close()
    const first = await app({ dbPath })
    expect(first.store.game('crashed-live')!.status).toBe('interrupted')
    expect(first.store.game('study-in-progress')!.status).toBe('running') // another process may be running it
    // Its events stay secret until it's over: every rotation of a duplicate group deals the same cards.
    const studyEvents = await fetch(`${first.url}/api/games/study-in-progress/events`)
    expect(studyEvents.status).toBe(409)
    expect(await studyEvents.text()).not.toContain('cards_dealt')
    // A second server process (simulated: another running process holds the lock) is refused.
    writeFileSync(`${dbPath}.server.lock`, String(process.ppid))
    await expect(app({ dbPath })).rejects.toThrow(/another live server/)
    writeFileSync(`${dbPath}.server.lock`, String(process.pid))
  })

  it('guards the admin API: off without a token, 401 with a wrong one', async () => {
    const off = await app({ adminToken: null })
    expect((await admin(off, '/api/admin/games')).status).toBe(403)
    const on = await app()
    expect((await admin(on, '/api/admin/games', 'wrong-token-wrong-token')).status).toBe(401)
    expect((await fetch(`${on.url}/api/admin/games`, { method: 'POST' })).status).toBe(401)
    expect(on.live.gameId).toBeNull()
  })

  it('starts a live game, streams it, refuses a second, stops it, then publishes it', async () => {
    const a = await app()
    const started = await admin(a, '/api/admin/games')
    expect(started.status).toBe(201)
    const { gameId } = await started.json()
    expect((await admin(a, '/api/admin/games')).status).toBe(409)
    // While it runs: the feed shows it and its events so far can be read (to seek back), but its config is withheld.
    const feed = await readFeed(a, (m) => m.filter((x) => x.type === 'event').length >= 20)
    expect(feed[0]).toMatchObject({ type: 'snapshot', channel: { mode: 'live', gameId } })
    expect(feed.filter((m) => m.type === 'event').every((m) => (m as { event: { gameId: string } }).event.gameId === gameId)).toBe(true)
    expect((await (await fetch(`${a.url}/api/games/${gameId}`)).json()).config).toBeNull()
    const sofar = await (await fetch(`${a.url}/api/games/${gameId}/events`)).json()
    expect(sofar.game).toMatchObject({ id: gameId, status: 'running', config: null })
    expect(sofar.events[0]).toMatchObject({ type: 'game_started', gameId })
    expect(sofar.events.length).toBeGreaterThanOrEqual(20)
    const list = await (await fetch(`${a.url}/api/games`)).json()
    expect(list.games[0]).toMatchObject({ id: gameId, status: 'running' })
    expect(list.games[0]).not.toHaveProperty('config')
    // Stop it: it ends after the hand in progress, then everything is public.
    const stop = await admin(a, '/api/admin/games/stop')
    expect(stop.status).toBe(202)
    await a.live.idle()
    expect((await admin(a, '/api/admin/games/stop')).status).toBe(409)
    const done = await (await fetch(`${a.url}/api/games/${gameId}/events`)).json()
    expect(done.game).toMatchObject({ id: gameId, status: 'interrupted' })
    expect(done.game.config.tournament.seed).toMatch(/^[0-9a-f]{32}$/)
    expect(done.events.at(-1)).toMatchObject({ type: 'game_ended', reason: 'interrupted' })
  })

  it('allows the configured browser origin only', async () => {
    const a = await app({ allowedOrigin: 'http://localhost:3000' })
    const ok = await fetch(`${a.url}/api/state`, { headers: { Origin: 'http://localhost:3000' } })
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
    const other = await fetch(`${a.url}/api/state`, { headers: { Origin: 'http://evil.example' } })
    expect(other.headers.get('access-control-allow-origin')).toBeNull()
    const preflight = await fetch(`${a.url}/api/admin/games`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000' } })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-headers')).toMatch(/Authorization/)
  })

  it('turns spectators away beyond the limit', async () => {
    const a = await app({ maxClients: 1 })
    const ac = new AbortController()
    const first = await fetch(`${a.url}/api/feed`, { signal: ac.signal })
    expect(first.status).toBe(200)
    const second = await fetch(`${a.url}/api/feed`)
    expect(second.status).toBe(503)
    ac.abort()
  })

  it('on shutdown, ends a running live game as interrupted', async () => {
    const a = await app()
    const { gameId } = await (await admin(a, '/api/admin/games')).json()
    const view = () => a.hub.current().view
    await a.close()
    expect(a.live.gameId).toBeNull()
    expect(view()).toMatchObject({ gameId, status: 'ended', result: { reason: 'interrupted' } })
  })
})
