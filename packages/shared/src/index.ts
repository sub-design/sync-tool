// ─────────────────────────────────────────────
//  Core domain types
// ─────────────────────────────────────────────

export type JobDirection = 'ltr' | 'rtl' | 'bidir'
export type JobStatus    = 'idle' | 'queued' | 'running' | 'completed' | 'cancelled' | 'error'
export type TransferMode = 'full' | 'delta' | 'auto'

export interface JobReliability {
  encryptionEnabled?: boolean
  encryptionKeyId?:   string
  retryAttempts?:     number
  retryMinTimeoutMs?: number
  bandwidthLimitBps?: number
  concurrency?:       number
  notifyEmail?:       string
  notifyWebhookUrl?:  string
  resumeEnabled?:     boolean
}

export interface Job {
  id:          string
  name:        string
  source:      string
  destination: string
  direction:   JobDirection
  transferMode?: TransferMode
  reliability?: JobReliability
  sourceDeviceId?: string
  destinationDeviceId?: string
  watch?:      boolean      // auto-trigger when local filesystem changes are observed
  schedule?:   string       // cron expression, e.g. "0 */6 * * *"
  status:      JobStatus
  lastRun?:    number       // unix ms
  lastError?:  string
  createdAt:   number
  updatedAt:   number
}

export interface SyncResult {
  jobId:            string
  startedAt:        number
  endedAt:          number
  filesCopied:      number
  filesSkipped:     number
  filesErrored:     number
  bytesTransferred: number
  logicalBytes?:    number
  deltaBytes?:      number
  fullBytes?:       number
  deltaFiles?:      number
  fullFiles?:       number
  errors:           string[]
}

export interface SyncProgress {
  jobId:            string
  currentFile:      string
  filesProcessed:   number
  filesTotal:       number
  bytesTransferred: number
}

// ─────────────────────────────────────────────
//  WebSocket protocol: Agent ↔ API Server
//  Agent connects to ws://host:port/agent
// ─────────────────────────────────────────────

export type AgentToServer =
  | { type: 'register';     deviceId: string; hostname: string; platform: string }
  | { type: 'job:trigger';  jobId: string; reason: 'watch'; path?: string }
  | { type: 'job:started';  jobId: string }
  | { type: 'job:progress'; progress: SyncProgress }
  | { type: 'job:complete'; result: SyncResult }
  | { type: 'job:cancelled'; jobId: string }
  | { type: 'job:error';    jobId: string; error: string }

export type ServerToAgent =
  | { type: 'registered';  ok: true }
  | { type: 'jobs:watch';  jobs: Job[] }
  | { type: 'job:run';     job: Job }
  | { type: 'job:cancel';  jobId: string }

// ─────────────────────────────────────────────
//  WebSocket protocol: Browser ↔ API Server
//  Browser connects to ws://host:port/
// ─────────────────────────────────────────────

export type ServerToBrowser =
  | { type: 'agent:online';  deviceId: string; hostname: string }
  | { type: 'agent:offline'; deviceId: string }
  | { type: 'job:status';    jobId: string; status: JobStatus }
  | { type: 'job:progress';  progress: SyncProgress }
  | { type: 'job:complete';  result: SyncResult }
  | { type: 'job:cancelled'; jobId: string }
  | { type: 'job:error';     jobId: string; error: string }

// ─────────────────────────────────────────────
//  Phase A: Connect / Relay protocol
//  Agents register with Relay Server so they
//  can reach each other through NAT.
//  TODO: implement in Phase A
// ─────────────────────────────────────────────

export interface RelayDevice {
  deviceId:  string
  name:      string
  hostname:  string
  platform:  string
  online:    boolean
  lastSeen:  number
}

export type AgentToRelay =
  | { type: 'relay:register'; deviceId: string; name: string; hostname: string; platform: string }
  | { type: 'relay:data';     to: string; payload: string }   // payload = base64 tunnel data

export type RelayToAgent =
  | { type: 'relay:registered'; ok: true }
  | { type: 'relay:data';       from: string; payload: string }
  | { type: 'relay:peer:online';  deviceId: string; name: string }
  | { type: 'relay:peer:offline'; deviceId: string }
