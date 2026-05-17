import type { Job, DirEntry, AgentToken, AuditEntry, SyncLogFile, JobTemplate, Collection, CollectionTemplateLink, ApplyPreview, ApplyResult, CollectionUpdateResult } from '../types'
import { getToken, clearToken, getOrgId } from './auth'

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001'

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const orgId = getOrgId()
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(orgId ? { 'X-Org-Id': orgId } : {}),
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers })

  if (res.status === 401) {
    clearToken()
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }

  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export function login(email: string, password: string): Promise<{ token: string; orgId: string; user: { id: string; email: string } }> {
  return apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

export function register(email: string, password: string): Promise<{ token: string; orgId: string; user: { id: string; email: string } }> {
  return apiFetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

export function listJobs(): Promise<Job[]> {
  return apiFetch('/api/jobs')
}

export function getJob(id: string): Promise<Job> {
  return apiFetch(`/api/jobs/${id}`)
}

export function createJob(body: Omit<Job, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<Job> {
  return apiFetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateJob(id: string, body: Partial<Job>): Promise<Job> {
  return apiFetch(`/api/jobs/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteJob(id: string): Promise<void> {
  return apiFetch(`/api/jobs/${id}`, { method: 'DELETE' })
}

export function listJobTemplates(): Promise<JobTemplate[]> {
  return apiFetch('/api/job-templates')
}

export function createJobTemplate(body: Pick<JobTemplate, 'name' | 'description' | 'defaults'>): Promise<JobTemplate> {
  return apiFetch('/api/job-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateJobTemplate(id: string, body: Partial<Pick<JobTemplate, 'name' | 'description' | 'defaults'>>): Promise<JobTemplate> {
  return apiFetch(`/api/job-templates/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteJobTemplate(id: string): Promise<void> {
  return apiFetch(`/api/job-templates/${id}`, { method: 'DELETE' })
}

export function listCollections(): Promise<Collection[]> {
  return apiFetch('/api/collections')
}

export function getCollection(id: string): Promise<Collection> {
  return apiFetch(`/api/collections/${id}`)
}

export function createCollection(body: Pick<Collection, 'name' | 'description' | 'deviceIds'>): Promise<Collection> {
  return apiFetch('/api/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateCollection(
  id: string,
  body: Partial<Pick<Collection, 'name' | 'description' | 'deviceIds'>> & { deleteOrphanedJobs?: boolean },
): Promise<CollectionUpdateResult> {
  return apiFetch(`/api/collections/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteCollection(id: string): Promise<void> {
  return apiFetch(`/api/collections/${id}`, { method: 'DELETE' })
}

export function listAppliedTemplates(collectionId: string): Promise<CollectionTemplateLink[]> {
  return apiFetch(`/api/collections/${collectionId}/templates`)
}

export function previewApplyTemplate(collectionId: string, templateId: string): Promise<ApplyPreview> {
  return apiFetch(`/api/collections/${collectionId}/apply/preview?templateId=${encodeURIComponent(templateId)}`)
}

export function applyTemplateToCollection(
  collectionId: string,
  body: { templateId: string; source?: string; destination?: string },
): Promise<ApplyResult> {
  return apiFetch(`/api/collections/${collectionId}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function unapplyTemplateFromCollection(collectionId: string, templateId: string): Promise<void> {
  return apiFetch(`/api/collections/${collectionId}/templates/${templateId}`, { method: 'DELETE' })
}

export function getDerivedJobs(id: string): Promise<{ count: number; jobs: Job[] }> {
  return apiFetch(`/api/job-templates/${id}/derived`)
}

export function applyJobTemplate(id: string): Promise<{ updatedCount: number }> {
  return apiFetch(`/api/job-templates/${id}/apply`, { method: 'POST' })
}

export function runJob(id: string): Promise<void> {
  return apiFetch(`/api/jobs/${id}/run`, { method: 'POST' })
}

export function cancelJob(id: string): Promise<void> {
  return apiFetch(`/api/jobs/${id}/cancel`, { method: 'POST' })
}

export function getJobLog(id: string, limit?: number): Promise<unknown[]> {
  const qs = limit != null ? `?limit=${limit}` : ''
  return apiFetch(`/api/jobs/${id}/log${qs}`)
}

export function getRunFiles(runId: string): Promise<SyncLogFile[]> {
  return apiFetch(`/api/runs/${runId}/files`)
}

export function listDevices(): Promise<AgentToken[]> {
  return apiFetch('/api/devices')
}

export function createDevice(name: string, expiresInDays?: number): Promise<AgentToken & { token: string }> {
  return apiFetch('/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, expiresInDays }),
  })
}

export function rotateDevice(id: string, expiresInDays?: number): Promise<AgentToken & { token: string }> {
  return apiFetch(`/api/devices/${id}/rotate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresInDays }),
  })
}

export function deleteDevice(id: string): Promise<void> {
  return apiFetch(`/api/devices/${id}`, { method: 'DELETE' })
}

export function browseDir(deviceId: string, path: string): Promise<{ path: string; entries: DirEntry[] }> {
  const qs = new URLSearchParams({ deviceId, path })
  return apiFetch(`/api/browse?${qs}`)
}

export function listAudit(limit = 100): Promise<AuditEntry[]> {
  return apiFetch(`/api/audit?limit=${limit}`)
}

export interface AnalyticsSummary {
  totalRuns: number; successfulRuns: number; errorRuns: number
  totalBytesTransferred: number; totalFilesCopied: number; totalFilesDeleted: number
  periodDays: number
}
export interface DailyActivity { date: string; runs: number; errors: number; bytes: number }
export interface JobStat {
  jobId: string; jobName: string; runs: number; successfulRuns: number
  totalBytes: number; totalFiles: number; lastRun: number | null
}
export interface AnalyticsData {
  summary: AnalyticsSummary
  dailyActivity: DailyActivity[]
  byJob: JobStat[]
}
export function getAnalytics(days = 30): Promise<AnalyticsData> {
  return apiFetch(`/api/analytics?days=${days}`)
}

export interface RollbackPreview {
  logId: number
  status: string
  totalFiles: number
  filesToRestore: Array<{ relativePath: string; action: string; prevSize: number | null }>
  filesToDelete:  Array<{ relativePath: string }>
}

export function getRollbackPreview(jobId: string, logId: string): Promise<RollbackPreview> {
  return apiFetch(`/api/jobs/${jobId}/log/${logId}/rollback`)
}

export function triggerRollback(jobId: string, logId: string): Promise<{ ok: boolean; logId: number }> {
  return apiFetch(`/api/jobs/${jobId}/log/${logId}/rollback`, { method: 'POST' })
}
