// ─────────────────────────────────────────────
//  Core domain types
// ─────────────────────────────────────────────

export type JobDirection      = 'ltr' | 'rtl' | 'bidir'
export type JobStatus        = 'idle' | 'queued' | 'running' | 'completed' | 'cancelled' | 'error'
export type TransferMode     = 'full' | 'delta' | 'auto'
export type ConflictStrategy = 'newer-wins' | 'skip' | 'manual'
export type DeletionPolicy   = 'backup' | 'backup-with-deletes' | 'mirror'

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
  conflictStrategy?: ConflictStrategy
  deletionPolicy?: DeletionPolicy
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

export type RollbackFileAction = 'overwritten' | 'deleted' | 'created'
export type RollbackSide       = 'dst' | 'src'

export interface RollbackFileEntry {
  relativePath:  string
  side:          RollbackSide
  action:        RollbackFileAction
  backupPath:    string        // absolute local path on agent disk; '' when action === 'created'
  prevSize:      number | null
  prevMtimeMs:   number | null
  prevChecksum:  string | null
}

export interface RollbackManifest {
  jobId:     string
  backupId:  string    // UUID directory name under ~/.synctool/rollback/{jobId}/
  createdAt: number
  entries:   RollbackFileEntry[]
}

export interface RollbackResult {
  jobId:          string
  startedAt:      number
  endedAt:        number
  filesRestored:  number
  filesDeleted:   number
  filesErrored:   number
  errors:         string[]
}

export interface SyncResult {
  jobId:            string
  startedAt:        number
  endedAt:          number
  filesCopied:      number
  filesDeleted?:    number
  filesSkipped:     number
  filesErrored:     number
  conflictsPending?: number
  bytesTransferred: number
  logicalBytes?:    number
  deltaBytes?:      number
  fullBytes?:       number
  deltaFiles?:      number
  fullFiles?:       number
  transportMode?:   'local' | 'relay'
  errors:           string[]
  rollbackManifest?: RollbackManifest
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

export interface DirEntry {
  name:        string
  type:        'file' | 'directory'
  path:        string
  size?:       number
  modifiedAt?: number
}

export type AgentToServer =
  | { type: 'register';      deviceId: string; hostname: string; platform: string }
  | { type: 'job:trigger';   jobId: string; reason: 'watch'; path?: string }
  | { type: 'job:started';   jobId: string }
  | { type: 'job:progress';  progress: SyncProgress }
  | { type: 'job:complete';  result: SyncResult }
  | { type: 'job:cancelled'; jobId: string }
  | { type: 'job:error';     jobId: string; error: string }
  | { type: 'browse:result'; requestId: string; path: string; entries: DirEntry[]; error?: string }
  | { type: 'job:rollback:progress'; jobId: string; filesRestored: number; filesTotal: number; currentFile: string }
  | { type: 'job:rollback:complete'; jobId: string; result: RollbackResult }
  | { type: 'job:rollback:error';    jobId: string; error: string }

export type ServerToAgent =
  | { type: 'registered';      ok: true }
  | { type: 'jobs:watch';      jobs: Job[] }
  | { type: 'job:run';         job: Job }
  | { type: 'job:cancel';      jobId: string }
  | { type: 'browse:request';  requestId: string; path: string }
  | { type: 'job:rollback';    job: Job; logId: string; manifest: RollbackManifest }

// ─────────────────────────────────────────────
//  WebSocket protocol: Browser ↔ API Server
//  Browser connects to ws://host:port/
// ─────────────────────────────────────────────

export type ServerToBrowser =
  | { type: 'agent:online';   deviceId: string; hostname: string }
  | { type: 'agent:offline';  deviceId: string }
  | { type: 'job:status';     jobId: string; status: JobStatus }
  | { type: 'job:progress';   progress: SyncProgress }
  | { type: 'job:complete';   result: SyncResult }
  | { type: 'job:cancelled';  jobId: string }
  | { type: 'job:error';      jobId: string; error: string }
  | { type: 'job:rollback:progress'; jobId: string; filesRestored: number; filesTotal: number; currentFile: string }
  | { type: 'job:rollback:complete'; jobId: string; logId: string; result: RollbackResult }
  | { type: 'job:rollback:error';    jobId: string; logId: string; error: string }

// ─────────────────────────────────────────────
//  Phase A: Connect / Relay protocol
//  Agents register with Relay Server so they
//  can reach each other through NAT.
// ─────────────────────────────────────────────

export interface RelayDevice {
  deviceId:  string
  name:      string
  hostname:  string
  platform:  string
  online:    boolean
  lastSeen:  number
}

// SDP/ICE signal exchanged via relay for WebRTC hole-punch negotiation
export type RTCSignal =
  | { kind: 'offer' | 'answer'; sdp: string }
  | { kind: 'ice'; candidate: string; mid: string }

export type AgentToRelay =
  | { type: 'relay:register'; deviceId: string; name: string; hostname: string; platform: string; token?: string }
  | { type: 'relay:data';     to: string; payload: string }   // payload = base64 tunnel data
  | { type: 'relay:signal';   to: string; signal: RTCSignal } // WebRTC signaling

export type RelayToAgent =
  | { type: 'relay:registered'; ok: true }
  | { type: 'relay:error';      message: string }
  | { type: 'relay:data';       from: string; payload: string }
  | { type: 'relay:signal';     from: string; signal: RTCSignal }
  | { type: 'relay:peer:online';  deviceId: string; name: string }
  | { type: 'relay:peer:offline'; deviceId: string }
