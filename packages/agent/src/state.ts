import path from 'path'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { STATE_DIR } from './statePath'

export { STATE_DIR }

const JOBS_DIR    = path.join(STATE_DIR, 'jobs')
const LEGACY_FILE = path.join(STATE_DIR, 'agent-state.json')  // pre per-job path

if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
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
  return readLegacyJob(jobId) ?? new Map()
}

function replaceJob(jobId: string, states: Map<string, StoredFileState>): void {
  const file = jobFile(jobId)
  const tmp  = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(Object.fromEntries(states), null, 2), 'utf8')
  // Atomic on the same volume; prevents partial state after crashes.
  renameSync(tmp, file)
}

// ── In-memory cache ───────────────────────────────────────────────────────────
//
// Holds the state loaded at the start of each sync run until it is flushed.
// This avoids re-reading disk if getJobState is called more than once
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
    replaceJob(jobId, new Map())
    cache.delete(jobId)
  },
}

export type StateStore = typeof stateDb
