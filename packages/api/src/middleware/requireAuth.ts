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

async function resolveToken(token: string): Promise<string | null> {
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
    const url   = new URL(req.url ?? '/', 'http://localhost')
    const token = url.searchParams.get('token')
    if (!token) return null
    return resolveToken(token)
  } catch {
    return null
  }
}
