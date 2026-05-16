import { apiFetch } from './api'
import type { Endpoint, SavedEndpointConfig, BackendType } from '../types'

const json = (body: unknown) => ({
  method: 'POST' as const,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const endpointsApi = {
  list: () =>
    apiFetch<Endpoint[]>('/api/endpoints'),

  get: (id: string) =>
    apiFetch<Endpoint>(`/api/endpoints/${id}`),

  create: (data: { name: string; type: BackendType; config: SavedEndpointConfig; deviceId?: string }) =>
    apiFetch<Endpoint>('/api/endpoints', json(data)),

  update: (id: string, data: Partial<{ name: string; type: BackendType; config: SavedEndpointConfig; deviceId?: string }>) =>
    apiFetch<Endpoint>(`/api/endpoints/${id}`, {
      ...json(data),
      method: 'PATCH',
    }),

  delete: (id: string) =>
    apiFetch<void>(`/api/endpoints/${id}`, { method: 'DELETE' }),
}
