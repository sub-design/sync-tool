import type { Job } from '../types'

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, init)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export function listJobs(): Promise<Job[]> {
  return apiFetch('/jobs')
}

export function getJob(id: string): Promise<Job> {
  return apiFetch(`/jobs/${id}`)
}

export function createJob(body: Omit<Job, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<Job> {
  return apiFetch('/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateJob(id: string, body: Partial<Job>): Promise<Job> {
  return apiFetch(`/jobs/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deleteJob(id: string): Promise<void> {
  return apiFetch(`/jobs/${id}`, { method: 'DELETE' })
}

export function runJob(id: string): Promise<void> {
  return apiFetch(`/jobs/${id}/run`, { method: 'POST' })
}

export function cancelJob(id: string): Promise<void> {
  return apiFetch(`/jobs/${id}/cancel`, { method: 'POST' })
}

export function getJobLog(id: string, limit?: number): Promise<unknown[]> {
  const qs = limit != null ? `?limit=${limit}` : ''
  return apiFetch(`/jobs/${id}/log${qs}`)
}
