import type { Request, Response, NextFunction } from 'express'
import type { IncomingMessage } from 'http'
import { URL } from 'url'
import { verifyJwt, hashToken } from '../auth'
import { usersDb } from '../db'

declare global {
  namespace Express {
    interface Request { userId: string }
  }
}

export async function resolveToken(token: string): Promise<string | null> {
  const jwtPayload = verifyJwt(token)
  if (jwtPayload) return jwtPayload.userId
  return (await usersDb.getUserIdByToken(hashToken(token))) ?? null
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  const token  = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return }

  resolveToken(token).then((userId) => {
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return }
    req.userId = userId
    next()
  }).catch(() => res.status(500).json({ error: 'Internal server error' }))
}

export async function authFromWsRequest(req: IncomingMessage): Promise<string | null> {
  try {
    const token = wsTokenFromRequest(req)
    if (!token) return null
    return resolveToken(token)
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
