import type { Request, Response, NextFunction } from 'express'
import type { IncomingMessage } from 'http'
import { URL } from 'url'
import { verifyJwt, hashToken } from '../auth'
import { usersDb, membershipsDb, orgsDb } from '../db'
import type { OrgRole } from '@sync-tool/shared'

declare global {
  namespace Express {
    interface Request {
      userId: string
      orgId:  string          // always set after requireAuth (personal org if no header)
      orgRole: OrgRole        // role of userId in orgId
    }
  }
}

// ── Token resolution ──────────────────────────────────────────────────────────

export async function resolveToken(token: string): Promise<{ userId: string; orgId: string | undefined } | null> {
  const jwtPayload = verifyJwt(token)
  if (jwtPayload) return { userId: jwtPayload.userId, orgId: undefined }
  const row = await usersDb.getUserIdByToken(hashToken(token))
  return row ?? null
}

// ── requireAuth ───────────────────────────────────────────────────────────────

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  const token  = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return }

  resolveToken(token).then(async (result) => {
    if (!result) { res.status(401).json({ error: 'Unauthorized' }); return }

    const { userId } = result
    req.userId = userId

    // Determine orgId: prefer X-Org-Id header, fall back to token-bound org, then personal org
    const headerOrgId = req.headers['x-org-id'] as string | undefined
    const candidateOrgId = headerOrgId ?? result.orgId

    if (candidateOrgId) {
      const role = await membershipsDb.getRole(userId, candidateOrgId)
      if (!role) { res.status(403).json({ error: 'Not a member of this organization' }); return }
      req.orgId  = candidateOrgId
      req.orgRole = role
    } else {
      // Use/create personal org
      const user = await usersDb.getById(userId)
      if (!user) { res.status(401).json({ error: 'User not found' }); return }
      const orgs = await orgsDb.list(userId)
      if (orgs.length === 0) {
        // Edge case: just-created user before migration ran
        const orgId = await orgsDb.ensurePersonalOrg(userId, user.email)
        req.orgId  = orgId
        req.orgRole = 'owner'
      } else {
        req.orgId  = orgs[0].id
        const role = await membershipsDb.getRole(userId, orgs[0].id)
        req.orgRole = role ?? 'member'
      }
    }

    next()
  }).catch(() => res.status(500).json({ error: 'Internal server error' }))
}

// ── requireRole ───────────────────────────────────────────────────────────────

const ROLE_RANK: Record<OrgRole, number> = { owner: 4, admin: 3, member: 2, viewer: 1 }

/** Middleware that requires at least the given role in req.orgId. Must come after requireAuth. */
export function requireRole(minRole: OrgRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (ROLE_RANK[req.orgRole] >= ROLE_RANK[minRole]) { next(); return }
    res.status(403).json({ error: `Requires ${minRole} role` })
  }
}

// ── WebSocket auth ─────────────────────────────────────────────────────────────

export async function authFromWsRequest(req: IncomingMessage): Promise<{ userId: string; orgId: string | undefined } | null> {
  try {
    const token = wsTokenFromRequest(req)
    if (!token) return null
    const result = await resolveToken(token)
    if (!result) return null

    // Allow ?org= query param to scope the WS session
    const url = new URL(req.url ?? '/', 'http://localhost')
    const orgParam = url.searchParams.get('org') ?? undefined
    return { userId: result.userId, orgId: orgParam ?? result.orgId }
  } catch {
    return null
  }
}

export function wsTokenFromRequest(req: IncomingMessage): string | null {
  const authorization = req.headers.authorization
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7)

  const protocolToken = tokenFromWsProtocol(req.headers['sec-websocket-protocol'])
  if (protocolToken) return protocolToken

  if (process.env.ALLOW_LEGACY_WS_QUERY_TOKEN === 'true') {
    const url = new URL(req.url ?? '/', 'http://localhost')
    return url.searchParams.get('token')
  }

  return null
}

function tokenFromWsProtocol(value: string | string[] | undefined): string | null {
  const protocols = Array.isArray(value)
    ? value.flatMap((entry) => entry.split(','))
    : (value ?? '').split(',')

  for (const raw of protocols) {
    const protocol = raw.trim()
    if (!protocol.startsWith('auth.')) continue
    try {
      return Buffer.from(protocol.slice('auth.'.length), 'base64url').toString('utf8')
    } catch {
      return null
    }
  }

  return null
}
