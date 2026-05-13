import Database from 'better-sqlite3'
import path     from 'path'
import os       from 'os'
import { existsSync, mkdirSync } from 'fs'

const STATE_DIR = process.env.STATE_DIR
  ?? (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'SyncTool')
      : path.join(os.homedir(), '.synctool'))

if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })

const db = new Database(path.join(STATE_DIR, 'agent-state.db'))
db.pragma('journal_mode = WAL')

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS file_state (
    job_id        TEXT    NOT NULL,
    relative_path TEXT    NOT NULL,
    src_size      INTEGER,
    src_mtime_ms  INTEGER,
    dst_size      INTEGER,
    dst_mtime_ms  INTEGER,
    checksum      TEXT,            -- blake3/xxhash, populated in Phase 4 (Detect Moves)
    synced_at     INTEGER NOT NULL,
    PRIMARY KEY (job_id, relative_path)
  );
  CREATE INDEX IF NOT EXISTS idx_file_state_job ON file_state(job_id);
`)

// Safe migration: add checksum column to existing databases
try { db.exec(`ALTER TABLE file_state ADD COLUMN checksum TEXT`) } catch { /* already exists */ }

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StoredFileState {
  srcSize:    number | null   // null = wasn't present on this side at last sync
  srcMtimeMs: number | null
  dstSize:    number | null
  dstMtimeMs: number | null
  checksum?:  string          // content hash — populated in Phase 4
  syncedAt:   number
}

function rowToState(row: any): StoredFileState {
  return {
    srcSize:    row.src_size,
    srcMtimeMs: row.src_mtime_ms,
    dstSize:    row.dst_size,
    dstMtimeMs: row.dst_mtime_ms,
    checksum:   row.checksum ?? undefined,
    syncedAt:   row.synced_at,
  }
}

// ── State store ───────────────────────────────────────────────────────────────

export const stateDb = {

  /** Load all state for a job at once — call ONCE before sync, not per-file */
  getJobState(jobId: string): Map<string, StoredFileState> {
    const rows = db.prepare('SELECT * FROM file_state WHERE job_id = ?').all(jobId) as any[]
    const map  = new Map<string, StoredFileState>()
    for (const row of rows) map.set(row.relative_path, rowToState(row))
    return map
  },

  /** Bulk-write state after sync — single transaction for performance */
  setJobState(jobId: string, states: Map<string, StoredFileState>): void {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO file_state
        (job_id, relative_path, src_size, src_mtime_ms, dst_size, dst_mtime_ms, checksum, synced_at)
      VALUES
        (@jobId, @relativePath, @srcSize, @srcMtimeMs, @dstSize, @dstMtimeMs, @checksum, @syncedAt)
    `)
    const run = db.transaction((entries: [string, StoredFileState][]) => {
      for (const [relativePath, s] of entries) {
        stmt.run({
          jobId, relativePath,
          srcSize:    s.srcSize,
          srcMtimeMs: s.srcMtimeMs,
          dstSize:    s.dstSize,
          dstMtimeMs: s.dstMtimeMs,
          checksum:   s.checksum ?? null,
          syncedAt:   s.syncedAt,
        })
      }
    })
    run([...states.entries()])
  },

  clearJob(jobId: string): void {
    db.prepare('DELETE FROM file_state WHERE job_id = ?').run(jobId)
  },

  // ── Phase 4: Detect Moves ──────────────────────────────────────────────────
  // When a file disappears from one path and appears at another with the same
  // checksum, it was moved/renamed — no data transfer needed.
  // TODO Phase 4: implement findMovedFiles(jobId, currentFiles) using checksum index

}

export type StateStore = typeof stateDb
