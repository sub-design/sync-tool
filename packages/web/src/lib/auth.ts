const TOKEN_KEY  = 'sync_tool_token'
const ORG_KEY    = 'sync_tool_org_id'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export function getOrgId(): string | null {
  return localStorage.getItem(ORG_KEY)
}

export function setOrgId(orgId: string): void {
  localStorage.setItem(ORG_KEY, orgId)
}

export function clearOrgId(): void {
  localStorage.removeItem(ORG_KEY)
}

export function isLoggedIn(): boolean {
  return getToken() !== null
}

// Decode JWT payload without verification (browser-side, for display only)
export function getTokenPayload(): { sub: string; exp: number } | null {
  const token = getToken()
  if (!token) return null
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    // Check expiry
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      clearToken()
      return null
    }
    return payload
  } catch {
    return null
  }
}
