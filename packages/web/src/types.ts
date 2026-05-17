// ─── Organizations ─────────────────────────────────────────────────────────────

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer'
export type OrgPlan = 'starter' | 'pro' | 'enterprise'

export interface Organization {
  id:        string
  name:      string
  slug:      string
  plan:      OrgPlan
  parentId?: string
  createdAt: number
}

export interface Membership {
  id:        string
  userId:    string
  orgId:     string
  role:      OrgRole
  invitedBy?: string
  createdAt: number
}

// ─── Directories ────────────────────────────────────────────────────────────────

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
export type BackendType  = 'local' | 'sftp' | 'ftp' | 'ftps' | 's3' | 'smb' | 'nfs'

export interface SavedEndpointConfig {
  path?: string
  host?: string
  port?: number
  username?: string
  password?: string
  keyPath?: string
  bucket?: string
  region?: string
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  share?: string
  remotePath?: string
}

export interface Endpoint {
  id:        string
  name:      string
  type:      BackendType
  config:    SavedEndpointConfig
  deviceId?: string
  createdAt: number
  updatedAt: number
}

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
  s3:    {},
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

export interface JobAutoOptions {
  fileChangeDelaySec?: number
  onFolderConnect?: boolean
  onStart?: boolean
  periodicEveryMinutes?: number
  onLogoff?: boolean
  unattended?: boolean
  skipIfChangedPercent?: number
  waitForLocksMinutes?: number
  autoClearTreeAfterSync?: boolean
}

export interface Job {
  id: string; name: string; source: string; destination: string
  direction: JobDirection; transferMode?: TransferMode
  conflictStrategy?: ConflictStrategy
  deletionPolicy?: DeletionPolicy
  reliability?: JobReliability
  sourceDeviceId?: string; destinationDeviceId?: string
  sourceEndpointId?: string; destinationEndpointId?: string
  watch?: boolean
  schedule?: string
  autoOptions?: JobAutoOptions
  status: JobStatus
  lastRun?: number; nextRun?: number; lastError?: string; createdAt: number; updatedAt: number
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

export type SyncFileAction = 'copied' | 'deleted' | 'skipped' | 'errored'

export interface SyncFileEvent {
  relativePath: string
  isDirectory:  boolean
  action:       SyncFileAction
  size:         number | null
  mtimeMs:      number | null
  errorMsg?:    string
}

export interface SyncLogFile {
  id:            number
  run_id:        number
  relative_path: string
  is_directory:  boolean
  action:        SyncFileAction
  size:          number | null
  mtime_ms:      number | null
  error_msg:     string | null
}

export type ServerToBrowser =
  | { type: 'agent:online';  deviceId: string; hostname: string }
  | { type: 'agent:offline'; deviceId: string }
  | { type: 'job:status';    jobId: string; status: JobStatus }
  | { type: 'job:progress';  progress: SyncProgress }
  | { type: 'job:file:done'; jobId: string; file: SyncFileEvent }
  | { type: 'job:complete';  result: SyncResult }
  | { type: 'job:cancelled'; jobId: string }
  | { type: 'job:error';     jobId: string; error: string }
  | { type: 'job:rollback:progress'; jobId: string; filesRestored: number; filesTotal: number; currentFile: string }
  | { type: 'job:rollback:complete'; jobId: string; result: RollbackResult }
  | { type: 'job:rollback:error';    jobId: string; error: string }
