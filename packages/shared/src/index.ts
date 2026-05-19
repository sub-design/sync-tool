// ─────────────────────────────────────────────
//  Organization / Multi-tenancy types
// ─────────────────────────────────────────────

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer'
export type OrgPlan = 'starter' | 'pro' | 'enterprise'

export interface Organization {
  id:        string
  name:      string
  slug:      string
  plan:      OrgPlan
  parentId?: string   // MSP → client hierarchy
  createdAt: number
}

export interface Membership {
  id:          string
  userId:      string
  orgId:       string
  role:        OrgRole
  invitedBy?:  string
  createdAt:   number
}

// ─────────────────────────────────────────────
//  Endpoint types
// ─────────────────────────────────────────────

export type EndpointType = 'local' | 'sftp' | 'ftp' | 'ftps' | 's3' | 'smb' | 'nfs'

export interface SavedEndpointConfig {
  // Local / mounted
  path?: string
  // Remote common
  host?: string
  port?: number
  username?: string
  password?: string       // masked in API responses
  // SFTP
  keyPath?: string
  // S3
  bucket?: string
  region?: string
  endpoint?: string       // custom endpoint (MinIO, Cloudflare R2, etc.)
  accessKeyId?: string
  secretAccessKey?: string  // masked in API responses
  // SMB
  share?: string
  // SFTP / FTP / NFS / SMB path
  remotePath?: string
}

export interface Endpoint {
  id:        string
  name:      string
  type:      EndpointType
  config:    SavedEndpointConfig
  deviceId?: string   // required for type=local
  createdAt: number
  updatedAt: number
}

// ─────────────────────────────────────────────
//  Core domain types
// ─────────────────────────────────────────────

export type JobDirection      = 'ltr' | 'rtl' | 'bidir'
export type JobMode          = 'sync' | 'import'
export type JobStatus        = 'idle' | 'queued' | 'running' | 'completed' | 'cancelled' | 'error'
export type TransferMode     = 'full' | 'delta' | 'auto'
export type ConflictStrategy = 'newer-wins' | 'skip' | 'manual'
export type DeletionPolicy   = 'backup' | 'backup-with-deletes' | 'mirror'
export type DestinationLayout = 'sameTree' | 'byCaptureDate'
export type DateSource       = 'mtime' | 'exifThenMtime'
export type CollisionPolicy  = 'skipSameErrorDifferent'

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

export interface JobAutoOptions {
  fileChangeDelaySec?:      number
  onFolderConnect?:         boolean
  onStart?:                 boolean
  periodicEveryMinutes?:    number
  onLogoff?:                boolean
  unattended?:              boolean
  skipIfChangedPercent?:    number
  waitForLocksMinutes?:     number
  autoClearTreeAfterSync?:  boolean
}

export interface JobFilters {
  include?:        string[]
  exclude?:        string[]
  excludeHidden?:  boolean
  excludeSystem?:  boolean
  maxFileSizeMb?:  number
}

export interface Job {
  id:          string
  orgId?:      string   // set by API server; agents can ignore
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
  templateId?: string
  collectionId?: string
  sourceEndpointId?:      string   // ID of a saved Endpoint; resolved server-side at run time
  destinationEndpointId?: string
  watch?:      boolean      // auto-trigger when local filesystem changes are observed
  schedule?:   string       // cron expression, e.g. "0 */6 * * *"
  autoOptions?: JobAutoOptions
  filters?:    JobFilters
  destinationLayout?: DestinationLayout
  dateSource?:        DateSource
  collisionPolicy?:   CollisionPolicy
  jobMode?:    JobMode       // default: 'sync'
  status:      JobStatus
  lastRun?:    number       // unix ms
  lastError?:  string
  createdAt:   number
  updatedAt:   number
}

export type JobTemplateDefaults = Partial<Pick<Job,
  'name' | 'source' | 'destination' | 'direction' | 'jobMode' | 'transferMode' |
  'conflictStrategy' | 'deletionPolicy' | 'reliability' | 'filters' |
  'destinationLayout' | 'dateSource' | 'collisionPolicy' |
  'sourceDeviceId' | 'destinationDeviceId' | 'sourceEndpointId' | 'destinationEndpointId' |
  'watch' | 'schedule' | 'autoOptions'
>>

export interface JobTemplate {
  id:          string
  orgId?:      string
  name:        string
  description?: string
  defaults:    JobTemplateDefaults
  createdAt:   number
  updatedAt:   number
}

export type CollectionType = 'static' | 'dynamic'

export interface DeviceTags {
  platform?: string
  role?: string
  department?: string
  location?: string
  [key: string]: string | undefined
}

export interface MembershipRule {
  query: string
  description: string
}

export interface Collection {
  id:              string
  orgId?:          string
  name:            string
  description?:    string
  type:            CollectionType
  deviceIds?:      string[] // Only for static collections
  membershipRule?: MembershipRule // Only for dynamic collections
  createdAt:       number
  updatedAt:       number
}

export interface CollectionTemplate {
  id:           string
  orgId?:       string
  collectionId: string
  templateId:   string
  source:       string
  destination:  string
  appliedAt:    number
}

export interface CollectionTemplateWithMeta extends CollectionTemplate {
  templateName?: string
  jobCount:     number
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
  transportMode?:   'local' | 'direct' | 'p2p' | 'relay'
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

export type SyncFileAction = 'copied' | 'deleted' | 'skipped' | 'errored'

export interface SyncFileEvent {
  relativePath: string
  isDirectory:  boolean
  action:       SyncFileAction
  size:         number | null
  mtimeMs:      number | null
  errorMsg?:    string
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

export type JobTriggerReason = 'watch' | 'folder-connect' | 'logoff'

export type AgentToServer =
  | { type: 'register';      deviceId: string; hostname: string; platform: string }
  | { type: 'job:trigger';   jobId: string; reason: JobTriggerReason; path?: string }
  | { type: 'job:started';   jobId: string }
  | { type: 'job:progress';  progress: SyncProgress }
  | { type: 'job:file:done'; jobId: string; file: SyncFileEvent }
  | { type: 'job:complete';  result: SyncResult }
  | { type: 'job:cancelled'; jobId: string }
  | { type: 'job:error';     jobId: string; error: string }
  | { type: 'browse:result'; requestId: string; path: string; entries: DirEntry[]; error?: string }
  | { type: 'browse:create-folder:result'; requestId: string; path: string; error?: string }
  | { type: 'job:rollback:progress'; jobId: string; filesRestored: number; filesTotal: number; currentFile: string }
  | { type: 'job:rollback:complete'; jobId: string; result: RollbackResult }
  | { type: 'job:rollback:error';    jobId: string; error: string }

export type ServerToAgent =
  | { type: 'registered';      ok: true }
  | { type: 'jobs:watch';      jobs: Job[] }
  | { type: 'job:run';         job: Job }
  | { type: 'job:cancel';      jobId: string }
  | { type: 'browse:request';  requestId: string; path: string }
  | { type: 'browse:create-folder'; requestId: string; parentPath: string; name: string }
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
  | { type: 'job:file:done';  jobId: string; file: SyncFileEvent }
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
