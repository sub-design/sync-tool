import postgres from 'postgres'
import type { Job, SyncResult, RollbackManifest, RollbackResult } from '@sync-tool/shared'

// ── Connection ────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/sync_tool'

export const sql = postgres(DATABASE_URL, {
  max:          10,
  idle_timeout: 20,
  onnotice:     () => {},  // suppress NOTICE messages
})

// ── Schema init ───────────────────────────────────────────────────────────────

export async function initDb(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT    PRIMARY KEY,
      email         TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      created_at    BIGINT  NOT NULL
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS agent_tokens (
      id         TEXT   PRIMARY KEY,
      user_id    TEXT   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT   NOT NULL,
      token_hash TEXT   NOT NULL UNIQUE,
      created_at BIGINT NOT NULL
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS jobs (
      id                    TEXT   PRIMARY KEY,
      user_id               TEXT   REFERENCES users(id) ON DELETE CASCADE,
      name                  TEXT   NOT NULL,
      source                TEXT   NOT NULL,
      destination           TEXT   NOT NULL,
      direction             TEXT   NOT NULL DEFAULT 'ltr',
      transfer_mode         TEXT   DEFAULT 'auto',
      deletion_policy       TEXT   DEFAULT 'backup',
      reliability           TEXT   DEFAULT '{}',
      source_device_id      TEXT,
      destination_device_id TEXT,
      watch                 BOOLEAN NOT NULL DEFAULT false,
      schedule              TEXT,
      status                TEXT   NOT NULL DEFAULT 'idle',
      last_run              BIGINT,
      last_error            TEXT,
      created_at            BIGINT NOT NULL,
      updated_at            BIGINT NOT NULL
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS sync_log (
      id                BIGSERIAL PRIMARY KEY,
      job_id            TEXT   NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      status            TEXT   NOT NULL DEFAULT 'completed',
      error_message     TEXT,
      started_at        BIGINT NOT NULL,
      ended_at          BIGINT,
      files_copied      INT    DEFAULT 0,
      files_deleted     INT    DEFAULT 0,
      files_skipped     INT    DEFAULT 0,
      files_errored     INT    DEFAULT 0,
      bytes_transferred BIGINT DEFAULT 0,
      logical_bytes     BIGINT DEFAULT 0,
      delta_bytes       BIGINT DEFAULT 0,
      full_bytes        BIGINT DEFAULT 0,
      delta_files       INT    DEFAULT 0,
      full_files        INT    DEFAULT 0,
      errors            TEXT   DEFAULT '[]'
    )
  `

  // Idempotent column additions (safe to run repeatedly)
  for (const stmt of [
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS transfer_mode TEXT DEFAULT 'auto'`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deletion_policy TEXT DEFAULT 'backup'`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS reliability TEXT DEFAULT '{}'`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_device_id TEXT`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS destination_device_id TEXT`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS watch BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE`,
    `ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS logical_bytes BIGINT DEFAULT 0`,
    `ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS files_deleted INT DEFAULT 0`,
    `ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS delta_bytes BIGINT DEFAULT 0`,
    `ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS full_bytes BIGINT DEFAULT 0`,
    `ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS delta_files INT DEFAULT 0`,
    `ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS full_files INT DEFAULT 0`,
    `ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed'`,
    `ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS error_message TEXT`,
    `ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS rollback_manifest TEXT`,
    `ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS rollback_status TEXT NOT NULL DEFAULT 'none'`,
    `ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS rollback_device_id TEXT`,
    `ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS is_rollback BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS rollback_of BIGINT`,
  ]) {
    await sql.unsafe(stmt)
  }
}

// ── Row mappers ───────────────────────────────────────────────────────────────

function rowToJob(row: Record<string, unknown>): Job {
  return {
    id:                  row.id as string,
    name:                row.name as string,
    source:              row.source as string,
    destination:         row.destination as string,
    direction:           row.direction as Job['direction'],
    transferMode:        ((row.transfer_mode as string) ?? 'auto') as Job['transferMode'],
    deletionPolicy:      ((row.deletion_policy as string) ?? 'backup') as Job['deletionPolicy'],
    reliability:         parseJson(row.reliability as string),
    sourceDeviceId:      (row.source_device_id as string) ?? undefined,
    destinationDeviceId: (row.destination_device_id as string) ?? undefined,
    watch:               Boolean(row.watch),
    schedule:            (row.schedule as string) ?? undefined,
    status:              row.status as Job['status'],
    lastRun:             row.last_run != null ? Number(row.last_run) : undefined,
    lastError:           (row.last_error as string) ?? undefined,
    createdAt:           Number(row.created_at),
    updatedAt:           Number(row.updated_at),
  }
}

function parseJson(value: unknown): Job['reliability'] {
  if (!value || typeof value !== 'string') return {}
  try { const p = JSON.parse(value); return p && typeof p === 'object' ? p : {} } catch { return {} }
}

// ── Users ─────────────────────────────────────────────────────────────────────

export interface UserRow {
  id:           string
  email:        string
  passwordHash: string
  createdAt:    number
}

export const usersDb = {
  async count(): Promise<number> {
    const [{ n }] = await sql<[{ n: string }]>`SELECT COUNT(*)::text AS n FROM users`
    return parseInt(n)
  },

  async create(id: string, email: string, passwordHash: string): Promise<UserRow> {
    const now = Date.now()
    await sql`INSERT INTO users (id, email, password_hash, created_at) VALUES (${id}, ${email}, ${passwordHash}, ${now})`
    return { id, email, passwordHash, createdAt: now }
  },

  async getByEmail(email: string): Promise<UserRow | undefined> {
    const [row] = await sql`SELECT * FROM users WHERE email = ${email}`
    return row ? { id: row.id, email: row.email, passwordHash: row.password_hash, createdAt: Number(row.created_at) } : undefined
  },

  async getById(id: string): Promise<UserRow | undefined> {
    const [row] = await sql`SELECT * FROM users WHERE id = ${id}`
    return row ? { id: row.id, email: row.email, passwordHash: row.password_hash, createdAt: Number(row.created_at) } : undefined
  },

  async createToken(id: string, userId: string, name: string, tokenHash: string): Promise<void> {
    await sql`INSERT INTO agent_tokens (id, user_id, name, token_hash, created_at) VALUES (${id}, ${userId}, ${name}, ${tokenHash}, ${Date.now()})`
  },

  async listTokens(userId: string): Promise<Array<{ id: string; name: string; createdAt: number }>> {
    const rows = await sql`SELECT id, name, created_at FROM agent_tokens WHERE user_id = ${userId} ORDER BY created_at DESC`
    return rows.map((r) => ({ id: r.id, name: r.name, createdAt: Number(r.created_at) }))
  },

  async deleteToken(id: string, userId: string): Promise<boolean> {
    const result = await sql`DELETE FROM agent_tokens WHERE id = ${id} AND user_id = ${userId}`
    return result.count > 0
  },

  async getUserIdByToken(tokenHash: string): Promise<string | undefined> {
    const [row] = await sql`SELECT user_id FROM agent_tokens WHERE token_hash = ${tokenHash}`
    return row?.user_id
  },
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

export const jobsDb = {
  async list(): Promise<Job[]> {
    const rows = await sql`SELECT * FROM jobs ORDER BY created_at DESC`
    return rows.map(rowToJob)
  },

  async listForUser(userId: string): Promise<Job[]> {
    const rows = await sql`SELECT * FROM jobs WHERE user_id = ${userId} ORDER BY created_at DESC`
    return rows.map(rowToJob)
  },

  async get(id: string): Promise<Job | undefined> {
    const [row] = await sql`SELECT * FROM jobs WHERE id = ${id}`
    return row ? rowToJob(row) : undefined
  },

  async getUserId(id: string): Promise<string | undefined> {
    const [row] = await sql`SELECT user_id FROM jobs WHERE id = ${id}`
    return row?.user_id ?? undefined
  },

  async create(job: Omit<Job, 'status' | 'createdAt' | 'updatedAt'>, userId: string): Promise<Job> {
    const now  = Date.now()
    const full: Job = { ...job, status: 'idle', createdAt: now, updatedAt: now }
    await sql`
      INSERT INTO jobs
        (id, user_id, name, source, destination, direction, transfer_mode, deletion_policy, reliability,
         source_device_id, destination_device_id, watch, schedule, status, created_at, updated_at)
      VALUES
        (${full.id}, ${userId}, ${full.name}, ${full.source}, ${full.destination},
         ${full.direction}, ${full.transferMode ?? 'auto'}, ${full.deletionPolicy ?? 'backup'}, ${JSON.stringify(full.reliability ?? {})},
         ${full.sourceDeviceId ?? null}, ${full.destinationDeviceId ?? null},
         ${full.watch ?? false}, ${full.schedule ?? null},
         ${full.status}, ${full.createdAt}, ${full.updatedAt})
    `
    return full
  },

  async update(id: string, patch: Partial<Pick<Job, 'name' | 'source' | 'destination' | 'direction' | 'transferMode' | 'deletionPolicy' | 'reliability' | 'sourceDeviceId' | 'destinationDeviceId' | 'watch' | 'schedule'>>): Promise<Job | undefined> {
    const existing = await jobsDb.get(id)
    if (!existing) return undefined
    const updated: Job = { ...existing, ...patch, updatedAt: Date.now() }
    await sql`
      UPDATE jobs SET
        name = ${updated.name},
        source = ${updated.source},
        destination = ${updated.destination},
        direction = ${updated.direction},
        transfer_mode = ${updated.transferMode ?? 'auto'},
        deletion_policy = ${updated.deletionPolicy ?? 'backup'},
        reliability = ${JSON.stringify(updated.reliability ?? {})},
        source_device_id = ${updated.sourceDeviceId ?? null},
        destination_device_id = ${updated.destinationDeviceId ?? null},
        watch = ${updated.watch ?? false},
        schedule = ${updated.schedule ?? null},
        updated_at = ${updated.updatedAt}
      WHERE id = ${id}
    `
    return updated
  },

  async delete(id: string): Promise<boolean> {
    const result = await sql`DELETE FROM jobs WHERE id = ${id}`
    return result.count > 0
  },

  async setStatus(id: string, status: Job['status'], lastError?: string): Promise<void> {
    const now     = Date.now()
    const lastRun = status === 'completed' || status === 'error' ? now : null
    await sql`
      UPDATE jobs SET
        status = ${status},
        last_run = ${lastRun},
        last_error = ${lastError ?? null},
        updated_at = ${now}
      WHERE id = ${id}
    `
  },
}

// ── Sync log ──────────────────────────────────────────────────────────────────

export interface SyncLogEntry {
  id:                 string
  job_id:             string
  status:             'completed' | 'error'
  error_message:      string | null
  started_at:         number
  ended_at:           number | null
  files_copied:       number
  files_deleted:      number
  files_skipped:      number
  files_errored:      number
  bytes_transferred:  number
  logical_bytes:      number
  delta_bytes:        number
  full_bytes:         number
  delta_files:        number
  full_files:         number
  errors:             string
  rollback_status:    'none' | 'available' | 'used' | 'expired'
  rollback_device_id: string | null
  is_rollback:        boolean
  rollback_of:        string | null
}

function rowToLogEntry(row: Record<string, unknown>): SyncLogEntry {
  return {
    id:                 String(row.id),
    job_id:             row.job_id as string,
    status:             (row.status as string) === 'error' ? 'error' : 'completed',
    error_message:      (row.error_message as string) ?? null,
    started_at:         Number(row.started_at),
    ended_at:           row.ended_at != null ? Number(row.ended_at) : null,
    files_copied:       Number(row.files_copied ?? 0),
    files_deleted:      Number(row.files_deleted ?? 0),
    files_skipped:      Number(row.files_skipped ?? 0),
    files_errored:      Number(row.files_errored ?? 0),
    bytes_transferred:  Number(row.bytes_transferred ?? 0),
    logical_bytes:      Number(row.logical_bytes ?? 0),
    delta_bytes:        Number(row.delta_bytes ?? 0),
    full_bytes:         Number(row.full_bytes ?? 0),
    delta_files:        Number(row.delta_files ?? 0),
    full_files:         Number(row.full_files ?? 0),
    errors:             (row.errors as string) ?? '[]',
    rollback_status:    ((row.rollback_status as string) ?? 'none') as SyncLogEntry['rollback_status'],
    rollback_device_id: (row.rollback_device_id as string) ?? null,
    is_rollback:        Boolean(row.is_rollback),
    rollback_of:        row.rollback_of != null ? String(row.rollback_of) : null,
  }
}

export const logDb = {
  async create(jobId: string): Promise<number> {
    const [{ id }] = await sql<[{ id: string }]>`
      INSERT INTO sync_log (job_id, started_at) VALUES (${jobId}, ${Date.now()}) RETURNING id::text
    `
    return parseInt(id)
  },

  async complete(logId: number, result: SyncResult): Promise<void> {
    await sql`
      UPDATE sync_log SET
        status            = 'completed',
        ended_at          = ${result.endedAt},
        files_copied      = ${result.filesCopied},
        files_deleted     = ${result.filesDeleted ?? 0},
        files_skipped     = ${result.filesSkipped},
        files_errored     = ${result.filesErrored},
        bytes_transferred = ${result.bytesTransferred},
        logical_bytes     = ${result.logicalBytes ?? 0},
        delta_bytes       = ${result.deltaBytes   ?? 0},
        full_bytes        = ${result.fullBytes    ?? 0},
        delta_files       = ${result.deltaFiles   ?? 0},
        full_files        = ${result.fullFiles    ?? 0},
        errors            = ${JSON.stringify(result.errors)}
      WHERE id = ${logId}
    `
  },

  /** Record a fully-failed run (job:error — no files transferred). */
  async fail(jobId: string, errorMessage: string): Promise<void> {
    const now = Date.now()
    await sql`
      INSERT INTO sync_log (job_id, status, error_message, started_at, ended_at)
      VALUES (${jobId}, 'error', ${errorMessage}, ${now}, ${now})
    `
  },

  async list(jobId: string, limit = 20): Promise<SyncLogEntry[]> {
    const rows = await sql`
      SELECT id, job_id, status, error_message, started_at, ended_at,
             files_copied, files_deleted, files_skipped, files_errored,
             bytes_transferred, logical_bytes, delta_bytes, full_bytes, delta_files, full_files,
             errors, rollback_status, rollback_device_id, is_rollback, rollback_of
      FROM sync_log WHERE job_id = ${jobId} ORDER BY started_at DESC LIMIT ${limit}
    `
    return rows.map(rowToLogEntry)
  },

  async saveRollbackManifest(logId: number, manifest: RollbackManifest, deviceId: string): Promise<void> {
    await sql`
      UPDATE sync_log SET
        rollback_manifest  = ${JSON.stringify(manifest)},
        rollback_status    = 'available',
        rollback_device_id = ${deviceId}
      WHERE id = ${logId}
    `
  },

  async getRollbackManifest(logId: number): Promise<{
    manifest: RollbackManifest
    deviceId: string
    status:   SyncLogEntry['rollback_status']
  } | undefined> {
    const [row] = await sql`
      SELECT rollback_manifest, rollback_device_id, rollback_status
      FROM sync_log WHERE id = ${logId}
    `
    if (!row?.rollback_manifest) return undefined
    return {
      manifest: JSON.parse(row.rollback_manifest as string) as RollbackManifest,
      deviceId: row.rollback_device_id as string,
      status:   (row.rollback_status as string) as SyncLogEntry['rollback_status'],
    }
  },

  /** Atomically mark a log entry's rollback as used (only if still 'available'). Returns false on race. */
  async markRollbackUsed(logId: number): Promise<boolean> {
    const result = await sql`
      UPDATE sync_log SET rollback_status = 'used'
      WHERE id = ${logId} AND rollback_status = 'available'
    `
    return result.count > 0
  },

  async resetRollbackToAvailable(logId: number): Promise<void> {
    await sql`UPDATE sync_log SET rollback_status = 'available' WHERE id = ${logId}`
  },

  async createRollbackRun(jobId: string, rollbackOf: number, result: RollbackResult): Promise<number> {
    const [{ id }] = await sql<[{ id: string }]>`
      INSERT INTO sync_log (
        job_id, status, started_at, ended_at,
        files_copied, files_deleted, files_skipped, files_errored,
        bytes_transferred, errors,
        is_rollback, rollback_of, rollback_status
      ) VALUES (
        ${jobId},
        ${result.filesErrored > 0 ? 'error' : 'completed'},
        ${result.startedAt}, ${result.endedAt},
        ${result.filesRestored}, ${result.filesDeleted}, 0, ${result.filesErrored},
        0, ${JSON.stringify(result.errors)},
        true, ${rollbackOf}, 'none'
      ) RETURNING id::text
    `
    return parseInt(id)
  },
}
