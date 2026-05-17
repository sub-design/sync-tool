import postgres from 'postgres'
import { v4 as uuid } from 'uuid'
import type { Job, Endpoint, SavedEndpointConfig, Organization, Membership, OrgRole, SyncResult, RollbackManifest, RollbackResult } from '@sync-tool/shared'

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
    CREATE TABLE IF NOT EXISTS audit_log (
      id          BIGSERIAL PRIMARY KEY,
      user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
      action      TEXT   NOT NULL,
      actor_type  TEXT   NOT NULL,
      actor_id    TEXT,
      ip          TEXT,
      user_agent  TEXT,
      target_type TEXT,
      target_id   TEXT,
      metadata    TEXT   DEFAULT '{}',
      created_at  BIGINT NOT NULL
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
      auto_options          TEXT   DEFAULT '{}',
      status                TEXT   NOT NULL DEFAULT 'idle',
      last_run              BIGINT,
      last_error            TEXT,
      created_at            BIGINT NOT NULL,
      updated_at            BIGINT NOT NULL
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS organizations (
      id         TEXT   PRIMARY KEY,
      name       TEXT   NOT NULL,
      slug       TEXT   NOT NULL UNIQUE,
      plan       TEXT   NOT NULL DEFAULT 'starter',
      parent_id  TEXT   REFERENCES organizations(id) ON DELETE SET NULL,
      created_at BIGINT NOT NULL
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS memberships (
      id          TEXT   PRIMARY KEY,
      user_id     TEXT   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_id      TEXT   NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      role        TEXT   NOT NULL DEFAULT 'member',
      invited_by  TEXT,
      created_at  BIGINT NOT NULL,
      UNIQUE (user_id, org_id)
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS endpoints (
      id         TEXT   PRIMARY KEY,
      user_id    TEXT   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT   NOT NULL,
      type       TEXT   NOT NULL,
      config     TEXT   NOT NULL DEFAULT '{}',
      device_id  TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
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

  await sql`
    CREATE TABLE IF NOT EXISTS sync_log_files (
      id            BIGSERIAL PRIMARY KEY,
      run_id        BIGINT NOT NULL REFERENCES sync_log(id) ON DELETE CASCADE,
      relative_path TEXT   NOT NULL,
      is_directory  BOOLEAN NOT NULL DEFAULT false,
      action        TEXT   NOT NULL,
      size          BIGINT,
      mtime_ms      BIGINT,
      error_msg     TEXT
    )
  `

  await sql`CREATE INDEX IF NOT EXISTS idx_slf_run_id ON sync_log_files (run_id)`

  // Idempotent column additions (safe to run repeatedly)
  for (const stmt of [
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS transfer_mode TEXT DEFAULT 'auto'`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deletion_policy TEXT DEFAULT 'backup'`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS reliability TEXT DEFAULT '{}'`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_device_id TEXT`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS destination_device_id TEXT`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS watch BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS auto_options TEXT DEFAULT '{}'`,
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
    `ALTER TABLE agent_tokens ADD COLUMN IF NOT EXISTS expires_at BIGINT`,
    `ALTER TABLE agent_tokens ADD COLUMN IF NOT EXISTS last_used_at BIGINT`,
    `ALTER TABLE agent_tokens ADD COLUMN IF NOT EXISTS revoked_at BIGINT`,
    `ALTER TABLE agent_tokens ADD COLUMN IF NOT EXISTS rotated_from TEXT`,
    `ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS transport_mode TEXT`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_endpoint_id TEXT REFERENCES endpoints(id) ON DELETE SET NULL`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS destination_endpoint_id TEXT REFERENCES endpoints(id) ON DELETE SET NULL`,
    `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE`,
    `ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE`,
    `ALTER TABLE agent_tokens ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE`,
    `ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES organizations(id) ON DELETE SET NULL`,
  ]) {
    await sql.unsafe(stmt)
  }

  await sql`CREATE INDEX IF NOT EXISTS audit_log_user_created_idx ON audit_log (user_id, created_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS agent_tokens_user_active_idx ON agent_tokens (user_id, revoked_at, expires_at)`

  // One-time data migration: create personal orgs for users that have none
  await migrateToOrgs()
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
    sourceDeviceId:        (row.source_device_id as string) ?? undefined,
    destinationDeviceId:   (row.destination_device_id as string) ?? undefined,
    orgId:                 (row.org_id as string) ?? undefined,
    sourceEndpointId:      (row.source_endpoint_id as string) ?? undefined,
    destinationEndpointId: (row.destination_endpoint_id as string) ?? undefined,
    watch:                 Boolean(row.watch),
    schedule:            (row.schedule as string) ?? undefined,
    autoOptions:         parseAutoOptions(row.auto_options),
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

function parseAutoOptions(value: unknown): Job['autoOptions'] {
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

  async createToken(id: string, userId: string, name: string, tokenHash: string, expiresAt: number | null, rotatedFrom?: string, orgId?: string): Promise<void> {
    await sql`
      INSERT INTO agent_tokens (id, user_id, org_id, name, token_hash, created_at, expires_at, rotated_from)
      VALUES (${id}, ${userId}, ${orgId ?? null}, ${name}, ${tokenHash}, ${Date.now()}, ${expiresAt}, ${rotatedFrom ?? null})
    `
  },

  async listTokens(userId: string, orgId?: string): Promise<Array<{ id: string; name: string; createdAt: number; expiresAt?: number; lastUsedAt?: number }>> {
    const rows = orgId
      ? await sql`
          SELECT id, name, created_at, expires_at, last_used_at
          FROM agent_tokens
          WHERE user_id = ${userId} AND org_id = ${orgId} AND revoked_at IS NULL
          ORDER BY created_at DESC
        `
      : await sql`
          SELECT id, name, created_at, expires_at, last_used_at
          FROM agent_tokens
          WHERE user_id = ${userId} AND revoked_at IS NULL
          ORDER BY created_at DESC
        `
    return rows.map((r) => ({
      id:         r.id,
      name:       r.name,
      createdAt:  Number(r.created_at),
      expiresAt:  r.expires_at != null ? Number(r.expires_at) : undefined,
      lastUsedAt: r.last_used_at != null ? Number(r.last_used_at) : undefined,
    }))
  },

  async revokeToken(id: string, userId: string): Promise<boolean> {
    const result = await sql`
      UPDATE agent_tokens SET revoked_at = ${Date.now()}
      WHERE id = ${id} AND user_id = ${userId} AND revoked_at IS NULL
    `
    return result.count > 0
  },

  async getToken(id: string, userId: string): Promise<{ id: string; name: string } | undefined> {
    const [row] = await sql`
      SELECT id, name FROM agent_tokens
      WHERE id = ${id} AND user_id = ${userId} AND revoked_at IS NULL
    `
    return row ? { id: row.id, name: row.name } : undefined
  },

  async getUserIdByToken(tokenHash: string): Promise<{ userId: string; orgId: string | undefined } | undefined> {
    const now = Date.now()
    const [row] = await sql`
      SELECT id, user_id, org_id, expires_at, revoked_at
      FROM agent_tokens
      WHERE token_hash = ${tokenHash}
    `
    if (!row || row.revoked_at != null) return undefined
    if (row.expires_at != null && Number(row.expires_at) <= now) return undefined
    await sql`UPDATE agent_tokens SET last_used_at = ${now} WHERE id = ${row.id}`
    return { userId: row.user_id as string, orgId: (row.org_id as string) ?? undefined }
  },
}

// ── Audit log ────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id:         string
  userId?:    string
  orgId?:     string
  action:     string
  actorType:  string
  actorId?:   string
  ip?:        string
  userAgent?: string
  targetType?: string
  targetId?:   string
  metadata:   Record<string, unknown>
  createdAt:  number
}

function rowToAuditEntry(row: Record<string, unknown>): AuditEntry {
  return {
    id:         String(row.id),
    userId:     (row.user_id as string) ?? undefined,
    orgId:      (row.org_id as string) ?? undefined,
    action:     row.action as string,
    actorType:  row.actor_type as string,
    actorId:    (row.actor_id as string) ?? undefined,
    ip:         (row.ip as string) ?? undefined,
    userAgent:  (row.user_agent as string) ?? undefined,
    targetType: (row.target_type as string) ?? undefined,
    targetId:   (row.target_id as string) ?? undefined,
    metadata:   parseAuditMetadata(row.metadata),
    createdAt:  Number(row.created_at),
  }
}

function parseAuditMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export const auditDb = {
  async record(entry: Omit<AuditEntry, 'id' | 'createdAt' | 'metadata'> & { metadata?: Record<string, unknown> }): Promise<void> {
    await sql`
      INSERT INTO audit_log
        (user_id, org_id, action, actor_type, actor_id, ip, user_agent, target_type, target_id, metadata, created_at)
      VALUES
        (${entry.userId ?? null}, ${entry.orgId ?? null}, ${entry.action}, ${entry.actorType}, ${entry.actorId ?? null},
         ${entry.ip ?? null}, ${entry.userAgent ?? null}, ${entry.targetType ?? null}, ${entry.targetId ?? null},
         ${JSON.stringify(entry.metadata ?? {})}, ${Date.now()})
    `
  },

  async listForUser(userId: string, limit = 100): Promise<AuditEntry[]> {
    const rows = await sql`
      SELECT id, user_id, action, actor_type, actor_id, ip, user_agent, target_type, target_id, metadata, created_at
      FROM audit_log
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${Math.min(Math.max(limit, 1), 500)}
    `
    return rows.map(rowToAuditEntry)
  },

  async listForOrg(orgId: string, limit = 100): Promise<AuditEntry[]> {
    const rows = await sql`
      SELECT id, user_id, action, actor_type, actor_id, ip, user_agent, target_type, target_id, metadata, created_at
      FROM audit_log
      WHERE org_id = ${orgId}
      ORDER BY created_at DESC
      LIMIT ${Math.min(Math.max(limit, 1), 500)}
    `
    return rows.map(rowToAuditEntry)
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

  async listForOrg(orgId: string): Promise<Job[]> {
    const rows = await sql`SELECT * FROM jobs WHERE org_id = ${orgId} ORDER BY created_at DESC`
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

  async create(job: Omit<Job, 'status' | 'createdAt' | 'updatedAt'>, userId: string, orgId?: string): Promise<Job> {
    const now  = Date.now()
    const full: Job = { ...job, orgId: orgId ?? job.orgId, status: 'idle', createdAt: now, updatedAt: now }
    await sql`
      INSERT INTO jobs
        (id, user_id, org_id, name, source, destination, direction, transfer_mode, deletion_policy, reliability,
         source_device_id, destination_device_id, source_endpoint_id, destination_endpoint_id,
         watch, schedule, auto_options, status, created_at, updated_at)
      VALUES
        (${full.id}, ${userId}, ${full.orgId ?? null}, ${full.name}, ${full.source}, ${full.destination},
         ${full.direction}, ${full.transferMode ?? 'auto'}, ${full.deletionPolicy ?? 'backup'}, ${JSON.stringify(full.reliability ?? {})},
         ${full.sourceDeviceId ?? null}, ${full.destinationDeviceId ?? null},
         ${full.sourceEndpointId ?? null}, ${full.destinationEndpointId ?? null},
         ${full.watch ?? false}, ${full.schedule ?? null}, ${JSON.stringify(full.autoOptions ?? {})},
         ${full.status}, ${full.createdAt}, ${full.updatedAt})
    `
    return full
  },

  async update(id: string, patch: Partial<Pick<Job, 'name' | 'source' | 'destination' | 'direction' | 'transferMode' | 'deletionPolicy' | 'reliability' | 'sourceDeviceId' | 'destinationDeviceId' | 'sourceEndpointId' | 'destinationEndpointId' | 'watch' | 'schedule' | 'autoOptions'>>): Promise<Job | undefined> {
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
        source_endpoint_id = ${updated.sourceEndpointId ?? null},
        destination_endpoint_id = ${updated.destinationEndpointId ?? null},
        watch = ${updated.watch ?? false},
        schedule = ${updated.schedule ?? null},
        auto_options = ${JSON.stringify(updated.autoOptions ?? {})},
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

// ── Endpoints ────────────────────────────────────────────────────────────────

function rowToEndpoint(row: Record<string, unknown>): Endpoint {
  return {
    id:        row.id as string,
    name:      row.name as string,
    type:      row.type as Endpoint['type'],
    config:    parseEndpointConfig(row.config),
    deviceId:  (row.device_id as string) ?? undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function parseEndpointConfig(value: unknown): SavedEndpointConfig {
  if (!value || typeof value !== 'string') return {}
  try { const p = JSON.parse(value); return p && typeof p === 'object' ? p : {} } catch { return {} }
}

export const endpointsDb = {
  /** List endpoints visible to an org (falls back to user-scoped if orgId absent). */
  async list(userId: string, orgId?: string): Promise<Endpoint[]> {
    const rows = orgId
      ? await sql`SELECT * FROM endpoints WHERE org_id = ${orgId} ORDER BY created_at DESC`
      : await sql`SELECT * FROM endpoints WHERE user_id = ${userId} ORDER BY created_at DESC`
    return rows.map(rowToEndpoint)
  },

  async get(id: string, userId: string, orgId?: string): Promise<Endpoint | undefined> {
    const [row] = orgId
      ? await sql`SELECT * FROM endpoints WHERE id = ${id} AND org_id = ${orgId}`
      : await sql`SELECT * FROM endpoints WHERE id = ${id} AND user_id = ${userId}`
    return row ? rowToEndpoint(row) : undefined
  },

  async create(userId: string, ep: Omit<Endpoint, 'createdAt' | 'updatedAt'>, orgId?: string): Promise<Endpoint> {
    const now = Date.now()
    await sql`
      INSERT INTO endpoints (id, user_id, org_id, name, type, config, device_id, created_at, updated_at)
      VALUES (${ep.id}, ${userId}, ${orgId ?? null}, ${ep.name}, ${ep.type}, ${JSON.stringify(ep.config)}, ${ep.deviceId ?? null}, ${now}, ${now})
    `
    return { ...ep, createdAt: now, updatedAt: now }
  },

  async update(id: string, userId: string, patch: Partial<Pick<Endpoint, 'name' | 'type' | 'config' | 'deviceId'>>, orgId?: string): Promise<Endpoint | undefined> {
    const existing = await endpointsDb.get(id, userId, orgId)
    if (!existing) return undefined
    const updated: Endpoint = { ...existing, ...patch, updatedAt: Date.now() }
    const clause = orgId
      ? sql`WHERE id = ${id} AND org_id = ${orgId}`
      : sql`WHERE id = ${id} AND user_id = ${userId}`
    await sql`
      UPDATE endpoints SET
        name      = ${updated.name},
        type      = ${updated.type},
        config    = ${JSON.stringify(updated.config)},
        device_id = ${updated.deviceId ?? null},
        updated_at = ${updated.updatedAt}
      ${clause}
    `
    return updated
  },

  async delete(id: string, userId: string, orgId?: string): Promise<boolean> {
    const result = orgId
      ? await sql`DELETE FROM endpoints WHERE id = ${id} AND org_id = ${orgId}`
      : await sql`DELETE FROM endpoints WHERE id = ${id} AND user_id = ${userId}`
    return result.count > 0
  },

  /** Returns jobs that reference this endpoint (for 409 on delete). */
  async findJobsUsing(endpointId: string): Promise<Array<{ id: string; name: string }>> {
    const rows = await sql`
      SELECT id, name FROM jobs
      WHERE source_endpoint_id = ${endpointId} OR destination_endpoint_id = ${endpointId}
    `
    return rows.map(r => ({ id: r.id as string, name: r.name as string }))
  },
}

// ── Sync log ──────────────────────────────────────────────────────────────────

export interface SyncLogEntry {
  id:                 string
  job_id:             string
  status:             'completed' | 'error' | 'cancelled'
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
  transport_mode:     string | null
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
    status:             (['error', 'cancelled'].includes(row.status as string) ? row.status : 'completed') as SyncLogEntry['status'],
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
    transport_mode:     (row.transport_mode as string) ?? null,
    errors:             (row.errors as string) ?? '[]',
    rollback_status:    ((row.rollback_status as string) ?? 'none') as SyncLogEntry['rollback_status'],
    rollback_device_id: (row.rollback_device_id as string) ?? null,
    is_rollback:        Boolean(row.is_rollback),
    rollback_of:        row.rollback_of != null ? String(row.rollback_of) : null,
  }
}

export interface SyncLogFile {
  id?:           number
  run_id:        number
  relative_path: string
  is_directory:  boolean
  action:        'copied' | 'deleted' | 'skipped' | 'errored'
  size:          number | null
  mtime_ms:      number | null
  error_msg:     string | null
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
        delta_bytes       = ${result.deltaBytes      ?? 0},
        full_bytes        = ${result.fullBytes       ?? 0},
        delta_files       = ${result.deltaFiles      ?? 0},
        full_files        = ${result.fullFiles       ?? 0},
        transport_mode    = ${result.transportMode   ?? null},
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

  /** Record a cancelled run — appears in history so the user knows it was stopped. */
  async cancel(jobId: string): Promise<void> {
    const now = Date.now()
    await sql`
      INSERT INTO sync_log (job_id, status, started_at, ended_at)
      VALUES (${jobId}, 'cancelled', ${now}, ${now})
    `
  },

  async list(jobId: string, limit = 20): Promise<SyncLogEntry[]> {
    const rows = await sql`
      SELECT id, job_id, status, error_message, started_at, ended_at,
             files_copied, files_deleted, files_skipped, files_errored,
             bytes_transferred, logical_bytes, delta_bytes, full_bytes, delta_files, full_files,
             transport_mode, errors, rollback_status, rollback_device_id, is_rollback, rollback_of
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

  async insertFiles(runId: number, files: SyncLogFile[]): Promise<void> {
    if (files.length === 0) return
    for (const f of files) {
      await sql`
        INSERT INTO sync_log_files (run_id, relative_path, is_directory, action, size, mtime_ms, error_msg)
        VALUES (${runId}, ${f.relative_path}, ${f.is_directory}, ${f.action}, ${f.size ?? null}, ${f.mtime_ms ?? null}, ${f.error_msg ?? null})
      `
    }
  },

  async getFiles(runId: number): Promise<SyncLogFile[]> {
    const rows = await sql`
      SELECT id, run_id, relative_path, is_directory, action, size, mtime_ms, error_msg
      FROM sync_log_files WHERE run_id = ${runId} ORDER BY relative_path
    `
    return rows.map(r => ({
      id:            Number(r.id),
      run_id:        Number(r.run_id),
      relative_path: r.relative_path as string,
      is_directory:  Boolean(r.is_directory),
      action:        r.action as SyncLogFile['action'],
      size:          r.size != null ? Number(r.size) : null,
      mtime_ms:      r.mtime_ms != null ? Number(r.mtime_ms) : null,
      error_msg:     (r.error_msg as string) ?? null,
    }))
  },
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export interface AnalyticsSummary {
  totalRuns:          number
  successfulRuns:     number
  errorRuns:          number
  totalBytesTransferred: number
  totalFilesCopied:   number
  totalFilesDeleted:  number
  periodDays:         number
}

export interface DailyActivity {
  date:   string   // YYYY-MM-DD
  runs:   number
  errors: number
  bytes:  number
}

export interface JobStat {
  jobId:          string
  jobName:        string
  runs:           number
  successfulRuns: number
  totalBytes:     number
  totalFiles:     number
  lastRun:        number | null
}

export const analyticsDb = {
  async summary(orgId: string, periodDays = 30): Promise<AnalyticsSummary> {
    const since = Date.now() - periodDays * 86_400_000
    const [row] = await sql`
      SELECT
        COUNT(sl.id)::int                                              AS total_runs,
        COUNT(sl.id) FILTER (WHERE sl.status = 'completed')::int      AS successful_runs,
        COUNT(sl.id) FILTER (WHERE sl.status = 'error')::int          AS error_runs,
        COALESCE(SUM(sl.bytes_transferred), 0)::bigint                AS total_bytes,
        COALESCE(SUM(sl.files_copied),      0)::int                   AS total_files_copied,
        COALESCE(SUM(sl.files_deleted),     0)::int                   AS total_files_deleted
      FROM sync_log sl
      JOIN jobs j ON j.id = sl.job_id
      WHERE j.org_id = ${orgId}
        AND sl.started_at >= ${since}
        AND sl.is_rollback = false
    `
    return {
      totalRuns:             Number(row.total_runs     ?? 0),
      successfulRuns:        Number(row.successful_runs ?? 0),
      errorRuns:             Number(row.error_runs     ?? 0),
      totalBytesTransferred: Number(row.total_bytes    ?? 0),
      totalFilesCopied:      Number(row.total_files_copied  ?? 0),
      totalFilesDeleted:     Number(row.total_files_deleted ?? 0),
      periodDays,
    }
  },

  async dailyActivity(orgId: string, periodDays = 30): Promise<DailyActivity[]> {
    const since = Date.now() - periodDays * 86_400_000
    const rows = await sql`
      SELECT
        to_char(to_timestamp(sl.started_at / 1000) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
        COUNT(sl.id)::int                                             AS runs,
        COUNT(sl.id) FILTER (WHERE sl.status = 'error')::int         AS errors,
        COALESCE(SUM(sl.bytes_transferred), 0)::bigint               AS bytes
      FROM sync_log sl
      JOIN jobs j ON j.id = sl.job_id
      WHERE j.org_id = ${orgId}
        AND sl.started_at >= ${since}
        AND sl.is_rollback = false
      GROUP BY 1
      ORDER BY 1
    `
    return rows.map(r => ({
      date:   r.date as string,
      runs:   Number(r.runs),
      errors: Number(r.errors),
      bytes:  Number(r.bytes),
    }))
  },

  async byJob(orgId: string, periodDays = 30): Promise<JobStat[]> {
    const since = Date.now() - periodDays * 86_400_000
    const rows = await sql`
      SELECT
        j.id                                                                         AS job_id,
        j.name                                                                       AS job_name,
        COUNT(sl.id)::int                                                            AS runs,
        COUNT(sl.id) FILTER (WHERE sl.status = 'completed')::int                    AS successful_runs,
        COALESCE(SUM(sl.bytes_transferred), 0)::bigint                              AS total_bytes,
        COALESCE(SUM(sl.files_copied), 0)::int                                      AS total_files,
        MAX(sl.started_at)::bigint                                                   AS last_run
      FROM jobs j
      LEFT JOIN sync_log sl
        ON sl.job_id = j.id
        AND sl.is_rollback = false
        AND sl.started_at >= ${since}
      WHERE j.org_id = ${orgId}
      GROUP BY j.id, j.name
      ORDER BY total_bytes DESC NULLS LAST, runs DESC
      LIMIT 25
    `
    return rows.map(r => ({
      jobId:          r.job_id as string,
      jobName:        r.job_name as string,
      runs:           Number(r.runs),
      successfulRuns: Number(r.successful_runs),
      totalBytes:     Number(r.total_bytes),
      totalFiles:     Number(r.total_files),
      lastRun:        r.last_run != null ? Number(r.last_run) : null,
    }))
  },
}

// ── Organizations ─────────────────────────────────────────────────────────────

function rowToOrg(row: Record<string, unknown>): Organization {
  return {
    id:        row.id as string,
    name:      row.name as string,
    slug:      row.slug as string,
    plan:      (row.plan as Organization['plan']) ?? 'starter',
    parentId:  (row.parent_id as string) ?? undefined,
    createdAt: Number(row.created_at),
  }
}

export const orgsDb = {
  async list(userId: string): Promise<Organization[]> {
    const rows = await sql`
      SELECT o.* FROM organizations o
      JOIN memberships m ON m.org_id = o.id
      WHERE m.user_id = ${userId}
      ORDER BY o.created_at ASC
    `
    return rows.map(rowToOrg)
  },

  async get(id: string): Promise<Organization | undefined> {
    const [row] = await sql`SELECT * FROM organizations WHERE id = ${id}`
    return row ? rowToOrg(row) : undefined
  },

  async getBySlug(slug: string): Promise<Organization | undefined> {
    const [row] = await sql`SELECT * FROM organizations WHERE slug = ${slug}`
    return row ? rowToOrg(row) : undefined
  },

  async create(data: { name: string; slug: string; plan?: Organization['plan']; parentId?: string }): Promise<Organization> {
    const now = Date.now()
    const id  = uuid()
    await sql`
      INSERT INTO organizations (id, name, slug, plan, parent_id, created_at)
      VALUES (${id}, ${data.name}, ${data.slug}, ${data.plan ?? 'starter'}, ${data.parentId ?? null}, ${now})
    `
    return { id, name: data.name, slug: data.slug, plan: data.plan ?? 'starter', parentId: data.parentId, createdAt: now }
  },

  async update(id: string, patch: Partial<Pick<Organization, 'name' | 'plan' | 'parentId'>>): Promise<Organization | undefined> {
    const existing = await orgsDb.get(id)
    if (!existing) return undefined
    const updated: Organization = { ...existing, ...patch }
    await sql`
      UPDATE organizations SET
        name      = ${updated.name},
        plan      = ${updated.plan},
        parent_id = ${updated.parentId ?? null}
      WHERE id = ${id}
    `
    return updated
  },

  async delete(id: string): Promise<boolean> {
    const result = await sql`DELETE FROM organizations WHERE id = ${id}`
    return result.count > 0
  },

  /** Ensure personal org exists for user; returns its id. */
  async ensurePersonalOrg(userId: string, email: string): Promise<string> {
    const [existing] = await sql`
      SELECT o.id FROM organizations o
      JOIN memberships m ON m.org_id = o.id
      WHERE m.user_id = ${userId}
      LIMIT 1
    `
    if (existing) return existing.id as string

    const slug  = `personal-${userId.slice(0, 8)}`
    const orgId = uuid()
    const memId = uuid()
    const now   = Date.now()
    // Use a unique email prefix for the org name
    const label = email.split('@')[0] ?? 'My'
    await sql`
      INSERT INTO organizations (id, name, slug, plan, created_at)
      VALUES (${orgId}, ${`${label}'s Org`}, ${slug}, 'starter', ${now})
      ON CONFLICT (slug) DO NOTHING
    `
    // Re-select in case of conflict
    const [org] = await sql`SELECT id FROM organizations WHERE slug = ${slug}`
    const resolvedOrgId = (org?.id as string) ?? orgId
    await sql`
      INSERT INTO memberships (id, user_id, org_id, role, created_at)
      VALUES (${memId}, ${userId}, ${resolvedOrgId}, 'owner', ${now})
      ON CONFLICT (user_id, org_id) DO NOTHING
    `
    return resolvedOrgId
  },
}

// ── Memberships ───────────────────────────────────────────────────────────────

function rowToMembership(row: Record<string, unknown>): Membership {
  return {
    id:        row.id as string,
    userId:    row.user_id as string,
    orgId:     row.org_id as string,
    role:      (row.role as OrgRole) ?? 'member',
    invitedBy: (row.invited_by as string) ?? undefined,
    createdAt: Number(row.created_at),
  }
}

export interface MembershipWithEmail extends Membership {
  email: string
}

export const membershipsDb = {
  /** All orgs a user belongs to (already handled via orgsDb.list — this is for raw membership rows). */
  async listForUser(userId: string): Promise<Membership[]> {
    const rows = await sql`SELECT * FROM memberships WHERE user_id = ${userId} ORDER BY created_at ASC`
    return rows.map(rowToMembership)
  },

  /** All members of an org, joined with their email. */
  async listForOrg(orgId: string): Promise<MembershipWithEmail[]> {
    const rows = await sql`
      SELECT m.*, u.email
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.org_id = ${orgId}
      ORDER BY m.created_at ASC
    `
    return rows.map(r => ({ ...rowToMembership(r), email: r.email as string }))
  },

  async get(userId: string, orgId: string): Promise<Membership | undefined> {
    const [row] = await sql`SELECT * FROM memberships WHERE user_id = ${userId} AND org_id = ${orgId}`
    return row ? rowToMembership(row) : undefined
  },

  async getRole(userId: string, orgId: string): Promise<OrgRole | undefined> {
    const mem = await membershipsDb.get(userId, orgId)
    return mem?.role
  },

  async add(userId: string, orgId: string, role: OrgRole, invitedBy?: string): Promise<Membership> {
    const id  = uuid()
    const now = Date.now()
    await sql`
      INSERT INTO memberships (id, user_id, org_id, role, invited_by, created_at)
      VALUES (${id}, ${userId}, ${orgId}, ${role}, ${invitedBy ?? null}, ${now})
      ON CONFLICT (user_id, org_id) DO UPDATE SET role = ${role}
    `
    return { id, userId, orgId, role, invitedBy, createdAt: now }
  },

  async updateRole(userId: string, orgId: string, role: OrgRole): Promise<boolean> {
    const result = await sql`
      UPDATE memberships SET role = ${role} WHERE user_id = ${userId} AND org_id = ${orgId}
    `
    return result.count > 0
  },

  async remove(userId: string, orgId: string): Promise<boolean> {
    const result = await sql`DELETE FROM memberships WHERE user_id = ${userId} AND org_id = ${orgId}`
    return result.count > 0
  },
}

// ── One-time org migration ────────────────────────────────────────────────────

/** For every user who has no org membership, create a personal org and migrate their data. */
async function migrateToOrgs(): Promise<void> {
  const users = await sql<Array<{ id: string; email: string }>>`
    SELECT u.id, u.email
    FROM users u
    LEFT JOIN memberships m ON m.user_id = u.id
    WHERE m.id IS NULL
  `
  for (const user of users) {
    const orgId = await orgsDb.ensurePersonalOrg(user.id, user.email)
    await sql`UPDATE jobs          SET org_id = ${orgId} WHERE user_id = ${user.id} AND org_id IS NULL`
    await sql`UPDATE endpoints     SET org_id = ${orgId} WHERE user_id = ${user.id} AND org_id IS NULL`
    await sql`UPDATE agent_tokens  SET org_id = ${orgId} WHERE user_id = ${user.id} AND org_id IS NULL`
    await sql`UPDATE audit_log     SET org_id = ${orgId} WHERE user_id = ${user.id} AND org_id IS NULL`
  }
}
