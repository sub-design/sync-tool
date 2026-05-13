/**
 * Directory lock management
 *
 * Before syncing, we create _gsdata_/lock inside the source directory.
 * This prevents two jobs from syncing the same folder simultaneously.
 *
 * The lock contains our PID so stale locks (from crashed processes) are
 * automatically detected and removed.
 *
 * Analogous to GoodSync's _gsdata_/lock behaviour.
 */

import fs   from 'fs'
import path from 'path'
import os   from 'os'

const STALE_LOCK_AGE_MS = 30 * 60 * 1000  // treat locks older than 30 min as stale

interface LockData {
  pid:       number
  jobId:     string
  hostname:  string
  startedAt: number
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Acquire a lock on dirPath.
 * Throws if a live lock already exists.
 * Silently removes stale/dead locks and retries.
 */
export async function acquireLock(dirPath: string, jobId: string): Promise<void> {
  const lockPath = getLockPath(dirPath)
  await fs.promises.mkdir(path.dirname(lockPath), { recursive: true })

  // Check for existing lock
  try {
    const raw  = await fs.promises.readFile(lockPath, 'utf8')
    const lock = JSON.parse(raw) as LockData
    const age  = Date.now() - lock.startedAt
    const alive = isPidAlive(lock.pid)

    if (alive && age < STALE_LOCK_AGE_MS) {
      throw new Error(
        `Directory is locked by another sync (PID ${lock.pid}, ` +
        `started ${new Date(lock.startedAt).toLocaleTimeString()}). ` +
        `Job: ${lock.jobId}`
      )
    }

    // Dead or stale — remove it
    const reason = alive ? 'stale (>30 min)' : 'dead process'
    console.warn(`[lock] Removing ${reason} lock from PID ${lock.pid}`)
    await fs.promises.unlink(lockPath).catch(() => {})

  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err  // rethrow everything except "file not found"
  }

  // Write our lock
  const data: LockData = {
    pid:       process.pid,
    jobId,
    hostname:  os.hostname(),
    startedAt: Date.now(),
  }
  await fs.promises.writeFile(lockPath, JSON.stringify(data, null, 2), { flag: 'wx' })
  // 'wx' = exclusive create — if two agents race, only one wins
}

/** Release the lock. Safe to call even if lock was already removed. */
export async function releaseLock(dirPath: string): Promise<void> {
  try {
    await fs.promises.unlink(getLockPath(dirPath))
  } catch {
    // Already gone — fine
  }
}

/** Returns true if the path looks like a local filesystem path (not a URL). */
export function isLocalPath(p: string): boolean {
  return !p.match(/^[a-z][a-z0-9+\-.]*:\/\//i)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLockPath(dirPath: string): string {
  return path.join(dirPath, '_gsdata_', 'lock')
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)  // signal 0 = check existence only
    return true
  } catch {
    return false
  }
}
