import path     from 'path'
import os       from 'os'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

const STATE_DIR = process.env.STATE_DIR
  ?? (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'SyncTool')
      : path.join(os.homedir(), '.synctool'))

if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })

const STATE_FILE = path.join(STATE_DIR, 'agent-state.json')

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StoredFileState {
  srcSize:    number | null
  srcMtimeMs: number | null
  dstSize:    number | null
  dstMtimeMs: number | null
  checksum?:  string
  syncedAt:   number
}

type StateData = Record<string, Record<string, StoredFileState>>

function load(): StateData {
  if (!existsSync(STATE_FILE)) return {}
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')) } catch { return {} }
}

function save(data: StateData): void {
  writeFileSync(STATE_FILE, JSON.stringify(data), 'utf8')
}

// ── State store ───────────────────────────────────────────────────────────────

export const stateDb = {

  getJobState(jobId: string): Map<string, StoredFileState> {
    const data = load()
    const job  = data[jobId] ?? {}
    return new Map(Object.entries(job))
  },

  setJobState(jobId: string, states: Map<string, StoredFileState>): void {
    const data    = load()
    data[jobId]   = Object.fromEntries(states)
    save(data)
  },

  clearJob(jobId: string): void {
    const data = load()
    delete data[jobId]
    save(data)
  },
}

export type StateStore = typeof stateDb
