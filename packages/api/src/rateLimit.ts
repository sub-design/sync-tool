import type { Request, Response, NextFunction } from 'express'

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export function createRateLimiter(options: {
  windowMs: number
  max: number
  key: (req: Request) => string
  message?: string
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (hitRateLimit(options.key(req), options.windowMs, options.max)) {
      res.status(429).json({ error: options.message ?? 'Too many requests' })
      return
    }
    next()
  }
}

export function hitRateLimit(key: string, windowMs: number, max: number): boolean {
  const now = Date.now()
  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }

  existing.count++
  return existing.count > max
}

export function rateLimitIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for']
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]
  return (firstForwarded || req.socket.remoteAddress || 'unknown').trim()
}
