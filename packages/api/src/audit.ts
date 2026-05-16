import type { Request } from 'express'
import { auditDb } from './db'
import { rateLimitIp } from './rateLimit'

export function auditRequest(req: Request, action: string, options: {
  userId?: string
  actorType?: string
  actorId?: string
  targetType?: string
  targetId?: string
  metadata?: Record<string, unknown>
} = {}): void {
  void auditDb.record({
    userId:    options.userId ?? req.userId,
    orgId:     req.orgId,
    action,
    actorType: options.actorType ?? 'user',
    actorId:   options.actorId ?? options.userId ?? req.userId,
    ip:        rateLimitIp(req),
    userAgent: req.headers['user-agent'],
    targetType: options.targetType,
    targetId:   options.targetId,
    metadata:   options.metadata,
  }).catch((err) => {
    console.warn(`[audit] Failed to record ${action}: ${err.message}`)
  })
}

export function auditSystem(action: string, options: {
  userId?: string
  actorType?: string
  actorId?: string
  targetType?: string
  targetId?: string
  metadata?: Record<string, unknown>
  ip?: string
  userAgent?: string
} = {}): void {
  void auditDb.record({
    userId:    options.userId,
    action,
    actorType: options.actorType ?? 'system',
    actorId:   options.actorId,
    ip:        options.ip,
    userAgent: options.userAgent,
    targetType: options.targetType,
    targetId:   options.targetId,
    metadata:   options.metadata,
  }).catch((err) => {
    console.warn(`[audit] Failed to record ${action}: ${err.message}`)
  })
}
