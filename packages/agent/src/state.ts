import path from 'path'
import os from 'os'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync } from 'fs'

export const STATE_DIR = process.env.STATE_DIR
  ?? (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'SyncTool')
      : path.join(os.homedir(), '.synctool'))

const JOBS_DIR    = path.join(STATE_DIR, 'jobs')
const LEGACY_FILE = path.join(STATE_DIR, 'agent-state.json')  // pre per-job path
const DB_FILE     = path.join(STATE_DIR, 'agent-state.sqlite')

if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StoredFileState {
  srcSize:    number | null
  srcMtimeMs: number | null
  dstSize:    number | null
  dstMtimeMs: number | null
  checksum?:  string
  syncedAt:   number
}

interface StateRow {
  rel_path:     string
  src_size:     number | null
  src_mtime_ms: number | null
  dst_size:     number | null
  dst_mtime_ms: number | null
  checksum:     string | null
  synced_at:    number
}

// ── SQLite setup ──────────────────────────────────────────────────────────────

const db = new Database(DB_FILE)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS job_file_state (
    job_id       TEXT    NOT NULL,
    rel_path     TEXT    NOT NULL,
    src_size     INTEGER,
    src_mtime_ms REAL,
    dst_size     INTEGER,
    dst_mtime_ms REAL,
    checksum     TEXT,
    synced_at    INTEGER NOT NULL,
    PRIMARY KEY (job_id, rel_path)
  );

  CREATE TABLE IF NOT EXISTS migrated_jobs (
    job_id      TEXT    PRIMARY KEY,
    migrated_at INTEGER NOT NULL
  );
`)

const selectJob = db.prepare(`
  SELECT rel_path, src_size, src_mtime_ms, dst_size, dst_mtime_ms, checksum, synced_at
  FROM job_file_state
  WHERE job_id = ?
  ORDER BY rel_path
`)
const deleteJob = db.prepare('DELETE FROM job_file_state WHERE job_id = ?')
const upsertState = db.prepare(`
  INSERT INTO job_file_state (
    job_id, rel_path, src_size, src_mtime_ms, dst_size, dst_mtime_ms, checksum, synced_at
  ) VALUES (
    @jobId, @relPath, @srcSize, @srcMtimeMs, @dstSize, @dstMtimeMs, @checksum, @syncedAt
  )
`)
const isMigrated = db.prepare('SELECT 1 FROM migrated_jobs WHERE job_id = ?')
const markMigrated = db.prepare(`
  INSERT INTO migrated_jobs (job_id, migrated_at)
  VALUES (?, ?)
  ON CONFLICT(job_id) DO UPDATE SET migrated_at = excluded.migrated_at
`)

const replaceJob = db.transaction((jobId: string, states: Map<string, StoredFileState>) => {
  deleteJob.run(jobId)
  for (const [relPath, state] of states) {
    upsertState.run({
      jobId,
      relPath,
      srcSize:    state.srcSize,
      srcMtimeMs: state.srcMtimeMs,
      dstSize:    state.dstSize,
      dstMtimeMs: state.dstMtimeMs,
      checksum:   state.checksum ?? null,
      syncedAt:   state.syncedAt,
    })
  }
  markMigrated.run(jobId, Date.now())
})

const migrateJob = db.transaction((jobId: string) => {
  if (isMigrated.get(jobId)) return
  const legacy = readLegacyJob(jobId)
  if (legacy) {
    replaceJob(jobId, legacy)
    return
  }
  markMigrated.run(jobId, Date.now())
})

// ── Helpers ───────────────────────────────────────────────────────────────────

// Sanitize jobId to a safe filename (UUIDs are safe already; this is a safety net).
function jobFile(jobId: string): string {
  const safe = jobId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(JOBS_DIR, `${safe}.json`)
}

function readLegacyJob(jobId: string): Map<string, StoredFileState> | undefined {
  const file = jobFile(jobId)
  if (existsSync(file)) {
    try {
      return new Map<string, StoredFileState>(Object.entries(JSON.parse(readFileSync(file, 'utf8'))))
    } catch {
      return new Map()
    }
  }

  if (existsSync(LEGACY_FILE)) {
    try {
      const all = JSON.parse(readFileSync(LEGACY_FILE, 'utf8'))
      if (all[jobId]) {
        return new Map<string, StoredFileState>(Object.entries(all[jobId]))
      }
    } catch {}
  }

  return undefined
}

function readJob(jobId: string): Map<string, StoredFileState> {
  migrateJob(jobId)
  const rows = selectJob.all(jobId) as StateRow[]
  return new Map(rows.map((row) => [
    row.rel_path,
    {
      srcSize:    row.src_size,
      srcMtimeMs: row.src_mtime_ms,
      dstSize:    row.dst_size,
      dstMtimeMs: row.dst_mtime_ms,
      ...(row.checksum ? { checksum: row.checksum } : {}),
      syncedAt:   row.synced_at,
    },
  ]))
}

// ── In-memory cache ───────────────────────────────────────────────────────────
//
// Holds the state loaded at the start of each sync run until it is flushed.
// This avoids re-reading SQLite if getJobState is called more than once
// for the same job (e.g. analysis + bidir pass).

const cache = new Map<string, Map<string, StoredFileState>>()

// ── State store ───────────────────────────────────────────────────────────────

export const stateDb = {

  getJobState(jobId: string): Map<string, StoredFileState> {
    const hit = cache.get(jobId)
    if (hit) return hit
    const loaded = readJob(jobId)
    cache.set(jobId, loaded)
    return loaded
  },

  setJobState(jobId: string, states: Map<string, StoredFileState>): void {
    replaceJob(jobId, states)
    cache.set(jobId, states)
  },

  clearJob(jobId: string): void {
    deleteJob.run(jobId)
    markMigrated.run(jobId, Date.now())
    cache.delete(jobId)
  },
}

export type StateStore = typeof stateDb
