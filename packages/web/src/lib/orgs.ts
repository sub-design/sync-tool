import { apiFetch } from './api'
import type { Organization, Membership } from '../types'

export interface MemberWithEmail extends Membership {
  email: string
}

export interface OrgWithMembers extends Organization {
  members: MemberWithEmail[]
}

export const orgsApi = {
  list:          () => apiFetch<Organization[]>('/api/orgs'),
  getCurrent:    () => apiFetch<OrgWithMembers>('/api/orgs/current'),
  updateCurrent: (data: Partial<Pick<Organization, 'name' | 'plan'>>) =>
    apiFetch<Organization>('/api/orgs/current', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    }),
  listMembers:   () => apiFetch<MemberWithEmail[]>('/api/orgs/current/members'),
  addMember:     (email: string, role: string) =>
    apiFetch<MemberWithEmail>('/api/orgs/current/members', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, role }),
    }),
  updateMemberRole: (userId: string, role: string) =>
    apiFetch<{ ok: boolean }>(`/api/orgs/current/members/${userId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ role }),
    }),
  removeMember: (userId: string) =>
    apiFetch<{ ok: boolean }>(`/api/orgs/current/members/${userId}`, { method: 'DELETE' }),
}
