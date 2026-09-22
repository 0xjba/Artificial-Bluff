import { readFileSync, rmSync, writeFileSync } from 'node:fs'

/** Whether a process with this pid is running (on this machine). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Makes sure only one live server uses a database: a second one would mark the first one's running
 * game interrupted (and so publish its seed while it still plays). Writes `<db>.server.lock` with this
 * process id; a lock left by a process that is gone is taken over. Returns the release function.
 */
export function acquireServerLock(dbPath: string, pid = process.pid): () => void {
  if (dbPath === ':memory:') return () => undefined
  const path = `${dbPath}.server.lock`
  try {
    const holder = Number(readFileSync(path, 'utf8').trim())
    if (Number.isInteger(holder) && holder > 0 && holder !== pid && alive(holder)) {
      throw new Error(`another live server (pid ${holder}) is using ${dbPath}; stop it first`)
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  writeFileSync(path, String(pid))
  return () => {
    try {
      if (readFileSync(path, 'utf8').trim() === String(pid)) rmSync(path)
    } catch {
      // already gone
    }
  }
}
