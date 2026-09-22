import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { acquireServerLock } from '../src/lock'

const db = () => join(mkdtempSync(join(tmpdir(), 'ab-lock-')), 'live.db')

describe('server lock', () => {
  it('lets one server use a database, refuses a second while the first runs, and releases on close', () => {
    const path = db()
    const release = acquireServerLock(path)
    expect(readFileSync(`${path}.server.lock`, 'utf8')).toBe(String(process.pid))
    // Another running process (our parent) holding it: refused.
    writeFileSync(`${path}.server.lock`, String(process.ppid))
    expect(() => acquireServerLock(path)).toThrow(/another live server \(pid \d+\)/)
    writeFileSync(`${path}.server.lock`, String(process.pid))
    release()
    expect(existsSync(`${path}.server.lock`)).toBe(false)
  })

  it('takes over a lock left by a process that is gone, and ignores in-memory databases', () => {
    const path = db()
    writeFileSync(`${path}.server.lock`, '999999')
    const release = acquireServerLock(path)
    expect(readFileSync(`${path}.server.lock`, 'utf8')).toBe(String(process.pid))
    release()
    expect(acquireServerLock(':memory:')).toBeTypeOf('function')
  })
})
