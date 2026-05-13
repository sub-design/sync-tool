import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Job, SyncResult } from '@sync-tool/shared'

// ── Setup ─────────────────────────────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), '.data')
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

const db: Database.Database = new Database(join(DATA_DIR, 'sync-tool.db'))
db.pragma('journal_mode = WAL')   // safe concurrent reads
db.pragma('foreign_keys = ON')

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    source      TEXT    NOT NULL,
    destination TEXT    NOT NULL,
    direction   TEXT    NOT NULL DEFAULT 'ltr',
    transfer_mode TEXT  DEFAULT 'auto',
    reliability TEXT    DEFAULT '{}',
	    source_device_id TEXT,
	    destination_device_id TEXT,
	    watch       INTEGER NOT NULL DEFAULT 0,
	    schedule    TEXT,
    status      TEXT    NOT NULL DEFAULT 'idle',
    last_run    INTEGER,
    last_error  TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_log (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id            TEXT    NOT NULL,
    started_at        INTEGER NOT NULL,
    ended_at          INTEGER,
    files_copied      INTEGER DEFAULT 0,
    files_skipped     INTEGER DEFAULT 0,
    files_errored     INTEGER DEFAULT 0,
    bytes_transferred INTEGER DEFAULT 0,
    logical_bytes     INTEGER DEFAULT 0,
    delta_bytes       INTEGER DEFAULT 0,
    full_bytes        INTEGER DEFAULT 0,
    delta_files       INTEGER DEFAULT 0,
    full_files        INTEGER DEFAULT 0,
    errors            TEXT    DEFAULT '[]',
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  );
`)

const jobColumns = db.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string }>
if (!jobColumns.some((column) => column.name === 'transfer_mode')) {
  db.exec(`ALTER TABLE jobs ADD COLUMN transfer_mode TEXT DEFAULT 'auto'`)
}
if (!jobColumns.some((column) => column.name === 'reliability')) {
  db.exec(`ALTER TABLE jobs ADD COLUMN reliability TEXT DEFAULT '{}'`)
}
if (!jobColumns.some((column) => column.name === 'source_device_id')) {
  db.exec(`ALTER TABLE jobs ADD COLUMN source_device_id TEXT`)
}
if (!jobColumns.some((column) => column.name === 'destination_device_id')) {
  db.exec(`ALTER TABLE jobs ADD COLUMN destination_device_id TEXT`)
}
if (!jobColumns.some((column) => column.name === 'watch')) {
  db.exec(`ALTER TABLE jobs ADD COLUMN watch INTEGER NOT NULL DEFAULT 0`)
}

const syncLogColumns = db.prepare('PRAGMA table_info(sync_log)').all() as Array<{ name: string }>
for (const [name, ddl] of [
  ['logical_bytes', 'ALTER TABLE sync_log ADD COLUMN logical_bytes INTEGER DEFAULT 0'],
  ['delta_bytes', 'ALTER TABLE sync_log ADD COLUMN delta_bytes INTEGER DEFAULT 0'],
  ['full_bytes', 'ALTER TABLE sync_log ADD COLUMN full_bytes INTEGER DEFAULT 0'],
  ['delta_files', 'ALTER TABLE sync_log ADD COLUMN delta_files INTEGER DEFAULT 0'],
  ['full_files', 'ALTER TABLE sync_log ADD COLUMN full_files INTEGER DEFAULT 0'],
] as const) {
  if (!syncLogColumns.some((column) => column.name === name)) db.exec(ddl)
}

// ── Job helpers ───────────────────────────────────────────────────────────────

function rowToJob(row: any): Job {
  return {
    id:          row.id,
    name:        row.name,
    source:      row.source,
    destination: row.destination,
    direction:   row.direction,
    transferMode: row.transfer_mode ?? 'auto',
    reliability: parseReliability(row.reliability),
	    sourceDeviceId: row.source_device_id ?? undefined,
	    destinationDeviceId: row.destination_device_id ?? undefined,
	    watch:       Boolean(row.watch),
	    schedule:    row.schedule   ?? undefined,
    status:      row.status,
    lastRun:     row.last_run   ?? undefined,
    lastError:   row.last_error ?? undefined,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  }
}

// ── Job CRUD ──────────────────────────────────────────────────────────────────

export const jobsDb = {
  list(): Job[] {
    return (db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as any[]).map(rowToJob)
  },

  get(id: string): Job | undefined {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any
    return row ? rowToJob(row) : undefined
  },

  create(job: Omit<Job, 'status' | 'createdAt' | 'updatedAt'>): Job {
    const now = Date.now()
    const full: Job = { ...job, status: 'idle', createdAt: now, updatedAt: now }
    db.prepare(`
      INSERT INTO jobs
        (id, name, source, destination, direction, transfer_mode, reliability, source_device_id, destination_device_id, watch, schedule, status, created_at, updated_at)
      VALUES
        (@id, @name, @source, @destination, @direction, @transferMode, @reliability, @sourceDeviceId, @destinationDeviceId, @watch, @schedule, @status, @createdAt, @updatedAt)
    `).run({
      ...full,
      schedule:  full.schedule  ?? null,
      transferMode: full.transferMode ?? 'auto',
	      reliability: JSON.stringify(full.reliability ?? {}),
	      sourceDeviceId: full.sourceDeviceId ?? null,
	      destinationDeviceId: full.destinationDeviceId ?? null,
	      watch:     full.watch ? 1 : 0,
	      createdAt: full.createdAt,
      updatedAt: full.updatedAt,
    })
    return full
  },

  update(id: string, patch: Partial<Pick<Job, 'name' | 'source' | 'destination' | 'direction' | 'transferMode' | 'reliability' | 'sourceDeviceId' | 'destinationDeviceId' | 'watch' | 'schedule'>>): Job | undefined {
    const existing = jobsDb.get(id)
    if (!existing) return undefined
    const updated: Job = { ...existing, ...patch, updatedAt: Date.now() }
    db.prepare(`
      UPDATE jobs
      SET name=@name, source=@source, destination=@destination,
          direction=@direction, transfer_mode=@transferMode,
	          reliability=@reliability,
	          source_device_id=@sourceDeviceId, destination_device_id=@destinationDeviceId,
	          watch=@watch, schedule=@schedule, updated_at=@updatedAt
      WHERE id=@id
    `).run({
      id:          updated.id,
      name:        updated.name,
      source:      updated.source,
      destination: updated.destination,
      direction:   updated.direction,
      transferMode: updated.transferMode ?? 'auto',
	      reliability: JSON.stringify(updated.reliability ?? {}),
	      sourceDeviceId: updated.sourceDeviceId ?? null,
	      destinationDeviceId: updated.destinationDeviceId ?? null,
	      watch:      updated.watch ? 1 : 0,
	      schedule:    updated.schedule ?? null,
      updatedAt:   updated.updatedAt,
    })
    return updated
  },

  delete(id: string): boolean {
    return (db.prepare('DELETE FROM jobs WHERE id = ?').run(id) as any).changes > 0
  },

  // Called by agent WebSocket handler when job status changes
  setStatus(id: string, status: Job['status'], lastError?: string) {
    db.prepare(`
      UPDATE jobs
      SET status=@status, last_run=@lastRun, last_error=@lastError, updated_at=@now
      WHERE id=@id
    `).run({
      id,
      status,
      lastRun:   status === 'completed' || status === 'error' ? Date.now() : null,
      lastError: lastError ?? null,
      now:       Date.now(),
    })
  },
}

function parseReliability(value: unknown): Job['reliability'] {
  if (!value || typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

// ── Sync log ──────────────────────────────────────────────────────────────────

export const logDb = {
  create(jobId: string): number {
    return (db.prepare('INSERT INTO sync_log (job_id, started_at) VALUES (?, ?)').run(jobId, Date.now()) as any).lastInsertRowid as number
  },

  complete(logId: number, result: SyncResult) {
    db.prepare(`
      UPDATE sync_log
      SET ended_at=@endedAt, files_copied=@filesCopied, files_skipped=@filesSkipped,
          files_errored=@filesErrored, bytes_transferred=@bytesTransferred,
          logical_bytes=@logicalBytes, delta_bytes=@deltaBytes, full_bytes=@fullBytes,
          delta_files=@deltaFiles, full_files=@fullFiles, errors=@errors
      WHERE id=@id
    `).run({
      id:               logId,
      endedAt:          result.endedAt,
      filesCopied:      result.filesCopied,
      filesSkipped:     result.filesSkipped,
      filesErrored:     result.filesErrored,
      bytesTransferred: result.bytesTransferred,
      logicalBytes:     result.logicalBytes ?? 0,
      deltaBytes:       result.deltaBytes ?? 0,
      fullBytes:        result.fullBytes ?? 0,
      deltaFiles:       result.deltaFiles ?? 0,
      fullFiles:        result.fullFiles ?? 0,
      errors:           JSON.stringify(result.errors),
    })
  },

  list(jobId: string, limit = 20) {
    return db.prepare('SELECT * FROM sync_log WHERE job_id=? ORDER BY started_at DESC LIMIT ?').all(jobId, limit)
  },
}

export default db
