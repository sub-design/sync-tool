import path         from 'path'
import os           from 'os'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs'

export const STATE_DIR = process.env.STATE_DIR
  ?? (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'SyncTool')
      : path.join(os.homedir(), '.synctool'))

const JOBS_DIR      = path.join(STATE_DIR, 'jobs')
const LEGACY_FILE   = path.join(STATE_DIR, 'agent-state.json')  // pre-migration path

if (!existsSync(JOBS_DIR)) mkdirSync(JOBS_DIR, { recursive: true })

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StoredFileState {
  srcSize:    number | null
  srcMtimeMs: number | null
  dstSize:    number | null
  dstMtimeMs: number | null
  checksum?:  string
  syncedAt:   number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Sanitize jobId to a safe filename (UUIDs are safe already; this is a safety net).
function jobFile(jobId: string): string {
  const safe = jobId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(JOBS_DIR, `${safe}.json`)
}

function readJob(jobId: string): Map<string, StoredFileState> {
  const file = jobFile(jobId)
  if (existsSync(file)) {
    try {
      return new Map<string, StoredFileState>(Object.entries(JSON.parse(readFileSync(file, 'utf8'))))
    } catch {
      return new Map()
    }
  }

  // One-time migration from the legacy all-jobs JSON
  if (existsSync(LEGACY_FILE)) {
    try {
      const all = JSON.parse(readFileSync(LEGACY_FILE, 'utf8'))
      if (all[jobId]) {
        return new Map<string, StoredFileState>(Object.entries(all[jobId]))
      }
    } catch {}
  }

  return new Map()
}

function writeJob(jobId: string, states: Map<string, StoredFileState>): void {
  const file  = jobFile(jobId)
  const tmp   = `${file}.tmp`
  // Atomic write: write to temp then rename to avoid partial reads on crash
  writeFileSync(tmp, JSON.stringify(Object.fromEntries(states)), 'utf8')
  renameSync(tmp, file)
}

// ── In-memory cache ───────────────────────────────────────────────────────────
//
// Holds the state loaded at the start of each sync run until it is flushed.
// This avoids re-reading the file if getJobState is called more than once
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
    writeJob(jobId, states)
    cache.set(jobId, states)
  },

  clearJob(jobId: string): void {
    const file = jobFile(jobId)
    try { if (existsSync(file)) unlinkSync(file) } catch {}
    cache.delete(jobId)
  },
}

export type StateStore = typeof stateDb
