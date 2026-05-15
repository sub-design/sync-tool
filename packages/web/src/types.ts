export interface DirEntry {
  name:        string
  type:        'file' | 'directory'
  path:        string
  size?:       number
  modifiedAt?: number
}

export type JobDirection      = 'ltr' | 'rtl' | 'bidir'
export type JobStatus        = 'idle' | 'queued' | 'running' | 'completed' | 'cancelled' | 'error'
export type TransferMode     = 'full' | 'delta' | 'auto'
export type ConflictStrategy = 'newer-wins' | 'skip' | 'manual'
export type DeletionPolicy   = 'backup' | 'backup-with-deletes' | 'mirror'
export type BackendType  = 'local' | 'sftp' | 'ftp' | 'ftps' | 'smb' | 'nfs'

export interface EndpointConfig {
  type:       BackendType
  localPath:  string
  host:       string
  port:       string
  username:   string
  password:   string
  remotePath: string
  share:      string
}

export const BACKEND_DEFAULTS: Record<BackendType, Partial<EndpointConfig>> = {
  local: {},
  sftp:  { port: '22' },
  ftp:   { port: '21' },
  ftps:  { port: '990' },
  smb:   { port: '' },
  nfs:   { port: '' },
}

export interface JobReliability {
  encryptionEnabled?: boolean
  encryptionKeyId?: string
  retryAttempts?: number
  retryMinTimeoutMs?: number
  bandwidthLimitBps?: number
  concurrency?: number
  notifyEmail?: string
  notifyWebhookUrl?: string
  resumeEnabled?: boolean
}

export interface Job {
  id: string; name: string; source: string; destination: string
  direction: JobDirection; transferMode?: TransferMode
  conflictStrategy?: ConflictStrategy
  deletionPolicy?: DeletionPolicy
  reliability?: JobReliability
  sourceDeviceId?: string; destinationDeviceId?: string
  watch?: boolean
  schedule?: string; status: JobStatus
  lastRun?: number; lastError?: string; createdAt: number; updatedAt: number
}

export interface SyncProgress {
  jobId: string; currentFile: string
  filesProcessed: number; filesTotal: number; bytesTransferred: number
}

export interface SyncResult {
  jobId: string; startedAt: number; endedAt: number
  filesCopied: number; filesDeleted?: number; filesSkipped: number; filesErrored: number
  conflictsPending?: number
  bytesTransferred: number
  logicalBytes?: number; deltaBytes?: number; fullBytes?: number
  deltaFiles?: number; fullFiles?: number
  errors: string[]
}

export interface AgentToken {
  id: string
  name: string
  createdAt: number
  expiresAt?: number
  lastUsedAt?: number
}

export interface AuditEntry {
  id: string
  action: string
  actorType: string
  actorId?: string
  targetType?: string
  targetId?: string
  metadata: Record<string, unknown>
  createdAt: number
  ip?: string
}

export interface RollbackResult {
  jobId: string; startedAt: number; endedAt: number
  filesRestored: number; filesDeleted: number; filesErrored: number
  errors: string[]
}

export type ServerToBrowser =
  | { type: 'agent:online';  deviceId: string; hostname: string }
  | { type: 'agent:offline'; deviceId: string }
  | { type: 'job:status';    jobId: string; status: JobStatus }
  | { type: 'job:progress';  progress: SyncProgress }
  | { type: 'job:complete';  result: SyncResult }
  | { type: 'job:cancelled'; jobId: string }
  | { type: 'job:error';     jobId: string; error: string }
  | { type: 'job:rollback:progress'; jobId: string; filesRestored: number; filesTotal: number; currentFile: string }
  | { type: 'job:rollback:complete'; jobId: string; result: RollbackResult }
  | { type: 'job:rollback:error';    jobId: string; error: string }
