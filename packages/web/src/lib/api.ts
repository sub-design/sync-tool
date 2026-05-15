import type { Job, DirEntry } from '../types'
import { getToken, clearToken } from './auth'

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

export function login(email: string, password: string): Promise<{ token: string; user: { id: string; email: string } }> {
  return apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}

export function register(email: string, password: string): Promise<{ token: string; user: { id: string; email: string } }> {
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

export function listDevices(): Promise<Array<{ id: string; name: string; createdAt: number }>> {
  return apiFetch('/api/devices')
}

export function createDevice(name: string): Promise<{ id: string; name: string; token: string }> {
  return apiFetch('/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export function deleteDevice(id: string): Promise<void> {
  return apiFetch(`/api/devices/${id}`, { method: 'DELETE' })
}

export function browseDir(deviceId: string, path: string): Promise<{ path: string; entries: DirEntry[] }> {
  const qs = new URLSearchParams({ deviceId, path })
  return apiFetch(`/api/browse?${qs}`)
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
