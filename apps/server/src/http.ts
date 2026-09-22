import type { EventStore } from '@ab/core'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { ServerConfig } from './config'
import type { FeedMessage, Hub } from './hub'
import { LiveBusyError, type LiveController } from './live'
import { isOver, publicEvent, publicGame } from './public'
import { handIndex, modelsTable, type SummaryCache } from './summary'

export interface HttpDeps {
  config: Pick<ServerConfig, 'adminToken' | 'allowedOrigin' | 'maxClients' | 'mock'>
  /** Unsent bytes a spectator may fall behind by before being disconnected (a paused tab, a stalled network). */
  maxBufferedBytes?: number
  hub: Hub
  store: EventStore
  live: LiveController
  /** Keep-alive comment interval on the feed. */
  heartbeatMs?: number
  log?: (line: string) => void
}

/** Constant-time token check (hashing first makes the lengths equal). */
export function tokenMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/** Most events per page of /api/games/:id/events. */
export const EVENTS_PAGE_LIMIT = 5000

/**
 * A hub subscriber writing to one SSE response. A client that stops reading is disconnected once more
 * than `maxBuffered` bytes are waiting, so one slow spectator can't make the server buffer without limit.
 */
export function sseWriter(res: Pick<ServerResponse, 'write' | 'destroy' | 'writableEnded' | 'destroyed' | 'writableLength'>, maxBuffered: number): (m: FeedMessage) => void {
  return (m) => {
    if (res.writableEnded || res.destroyed) throw new Error('closed')
    if (res.writableLength > maxBuffered) {
      res.destroy()
      throw new Error('spectator too far behind')
    }
    res.write(`data: ${JSON.stringify(m)}\n\n`)
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

/**
 * The spectator and admin API:
 * - GET  /api/health            status and spectator count
 * - GET  /api/state             current channel and table view
 * - GET  /api/feed              Server-Sent Events: a snapshot, then events and equity updates
 * - GET  /api/games             finished and running games (configs withheld while running)
 * - GET  /api/games/:id         one game
 * - GET  /api/models           what each model has done across the finished live games
 * - GET  /api/hands/:id        every hand of a game, newest first, with tags and a headline
 * - GET  /api/games/:id/events events of a live game so far, or of a study once it is over, in pages:
 *                                ?after=<seq> (default 0), up to 5,000 per page; `next` is the next ?after
 * - POST /api/admin/games       start a live game (Authorization: Bearer ADMIN_TOKEN)
 * - POST /api/admin/games/stop  stop the live game after the current hand
 */
export function createHttpServer(deps: HttpDeps): Server {
  // Analysed games, so /api/models and /api/hands don't re-score the log on every request. Only
  // finished games are cached: a running one still changes.
  const summaries: SummaryCache = new Map()
  const heartbeatMs = deps.heartbeatMs ?? 15_000
  const maxBuffered = deps.maxBufferedBytes ?? 1_000_000

  const cors = (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin
    if (deps.config.allowedOrigin && origin === deps.config.allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }
  }

  const admin = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!deps.config.adminToken) {
      send(res, 403, { error: 'admin API disabled: set ADMIN_TOKEN to enable it' })
      return false
    }
    const header = req.headers.authorization ?? ''
    const given = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!given || !tokenMatches(given, deps.config.adminToken)) {
      send(res, 401, { error: 'bad or missing admin token' })
      return false
    }
    return true
  }

  const feed = (req: IncomingMessage, res: ServerResponse) => {
    if (deps.hub.clientCount >= deps.config.maxClients) return send(res, 503, { error: 'too many spectators, try again soon' })
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write('retry: 3000\n\n')
    const unsubscribe = deps.hub.subscribe(sseWriter(res, maxBuffered))
    const heartbeat = setInterval(() => {
      if (res.writableLength > maxBuffered) res.destroy()
      else res.write(': ping\n\n')
    }, heartbeatMs)
    const close = () => {
      clearInterval(heartbeat)
      unsubscribe()
    }
    req.on('close', close)
    res.on('error', close)
  }

  return createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    cors(req, res)
    const method = req.method ?? 'GET'
    let url: URL
    try {
      // Node accepts request targets that URL rejects (e.g. "//["): answer 400, never throw.
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      return send(res, 400, { error: 'bad request' })
    }
    const path = url.pathname.replace(/\/+$/, '') || '/'
    try {
      if (method === 'OPTIONS') {
        if (deps.config.allowedOrigin && req.headers.origin === deps.config.allowedOrigin) {
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST')
          res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
          res.setHeader('Access-Control-Max-Age', '600')
        }
        res.writeHead(204)
        return res.end()
      }
      if (method === 'GET' && path === '/api/health') {
        return send(res, 200, { ok: true, mode: deps.hub.current().channel.mode, liveGame: deps.live.gameId, spectators: deps.hub.clientCount, mock: deps.config.mock })
      }
      if (method === 'GET' && path === '/api/state') return send(res, 200, deps.hub.current())
      if (method === 'GET' && path === '/api/feed') return feed(req, res)
      if (method === 'GET' && path === '/api/games') {
        const games = deps.store
          .games()
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 100)
          .map((g) => {
            const { config: _config, ...rest } = publicGame(g)
            return rest
          })
        return send(res, 200, { games })
      }
      if (method === 'GET' && path === '/api/models') {
        return send(res, 200, modelsTable(deps.store, summaries))
      }
      const hands = path.match(/^\/api\/hands\/([A-Za-z0-9._:-]+)$/)
      if (method === 'GET' && hands) {
        const row = deps.store.game(hands[1]!)
        if (!row) return send(res, 404, { error: 'no such game' })
        // A study's hands stay secret until it is over: its decks repeat across rotations.
        if (!isOver(row) && row.kind !== 'live') return send(res, 409, { error: 'the study is not over yet (it can still be resumed)' })
        return send(res, 200, { game: publicGame(row), hands: handIndex(deps.store, row.id, isOver(row) ? summaries : new Map()) })
      }
      const game = path.match(/^\/api\/games\/([A-Za-z0-9._:-]+)(\/events)?$/)
      if (method === 'GET' && game) {
        const row = deps.store.game(game[1]!)
        if (!row) return send(res, 404, { error: 'no such game' })
        if (!game[2]) return send(res, 200, publicGame(row))
        const after = Number(url.searchParams.get('after') ?? 0)
        if (!Number.isInteger(after) || after < 0) return send(res, 400, { error: 'after must be a whole number' })
        const over = isOver(row)
        // A running live game's events are what the feed already showed. A study's stay secret until it
        // is over for good: every rotation of a duplicate group is dealt the same cards.
        if (!over && row.kind !== 'live') return send(res, 409, { error: 'the study is not over yet (it can still be resumed)' })
        const events = deps.store.events(row.id, after, EVENTS_PAGE_LIMIT).map((e) => publicEvent(e, over))
        const next = events.length === EVENTS_PAGE_LIMIT ? events.at(-1)!.seq : null
        return send(res, 200, { game: publicGame(row), events, next })
      }
      if (method === 'POST' && path === '/api/admin/games') {
        if (!admin(req, res)) return
        deps.live.start().then(
          ({ gameId }) => send(res, 201, { gameId }),
          (e: unknown) => {
            if (e instanceof LiveBusyError) return send(res, 409, { error: e.message, gameId: e.gameId })
            deps.log?.(`could not start a live game: ${e instanceof Error ? e.message : String(e)}`)
            send(res, 500, { error: 'could not start the game (see the server log)' })
          },
        )
        return
      }
      if (method === 'POST' && path === '/api/admin/games/stop') {
        if (!admin(req, res)) return
        const stopping = deps.live.stop()
        return stopping ? send(res, 202, { stopping, note: 'the game ends after the hand in progress' }) : send(res, 409, { error: 'no live game' })
      }
      return send(res, 404, { error: 'not found' })
    } catch (e) {
      deps.log?.(`request ${method} ${path} failed: ${e instanceof Error ? e.message : String(e)}`)
      if (!res.headersSent) send(res, 500, { error: 'internal error' })
      else res.end()
    }
  })
}
