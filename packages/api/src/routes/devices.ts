import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { randomToken, hashToken } from '../auth'
import { usersDb } from '../db'
import { requireAuth } from '../middleware/requireAuth'
import { createRateLimiter, rateLimitIp } from '../rateLimit'
import { auditRequest } from '../audit'

const DEFAULT_AGENT_TOKEN_TTL_DAYS = Math.max(1, parseInt(process.env.AGENT_TOKEN_TTL_DAYS ?? '90', 10))

export function createDevicesRouter(): Router {
  const router = Router()
  router.use(requireAuth)
  const createTokenRateLimit = createRateLimiter({
    windowMs: 10 * 60_000,
    max:      10,
    key:      (req) => `device-token:${req.userId}:${rateLimitIp(req)}`,
  })

  router.get('/', async (req, res) => {
    res.json(await usersDb.listTokens(req.userId))
  })

  router.post('/', createTokenRateLimit, async (req, res) => {
    const { name, expiresInDays } = req.body
    if (!name) { res.status(400).json({ error: 'name is required' }); return }
    const ttlDays = Number.isInteger(expiresInDays) && expiresInDays > 0 && expiresInDays <= 3650
      ? expiresInDays
      : DEFAULT_AGENT_TOKEN_TTL_DAYS
    const id    = uuid()
    const token = randomToken()
    const expiresAt = Date.now() + ttlDays * 24 * 60 * 60 * 1000
    await usersDb.createToken(id, req.userId, name, hashToken(token), expiresAt)
    auditRequest(req, 'agent_token.created', {
      targetType: 'agent_token',
      targetId:   id,
      metadata:   { name, expiresAt },
    })
    res.status(201).json({ id, name, token, expiresAt })
  })

  router.post('/:id/rotate', createTokenRateLimit, async (req, res) => {
    const existing = await usersDb.getToken(req.params.id, req.userId)
    if (!existing) { res.status(404).json({ error: 'Token not found' }); return }

    const { expiresInDays } = req.body ?? {}
    const ttlDays = Number.isInteger(expiresInDays) && expiresInDays > 0 && expiresInDays <= 3650
      ? expiresInDays
      : DEFAULT_AGENT_TOKEN_TTL_DAYS
    const id = uuid()
    const token = randomToken()
    const expiresAt = Date.now() + ttlDays * 24 * 60 * 60 * 1000

    await usersDb.createToken(id, req.userId, existing.name, hashToken(token), expiresAt, existing.id)
    await usersDb.revokeToken(existing.id, req.userId)
    auditRequest(req, 'agent_token.rotated', {
      targetType: 'agent_token',
      targetId:   id,
      metadata:   { rotatedFrom: existing.id, name: existing.name, expiresAt },
    })
    res.status(201).json({ id, name: existing.name, token, expiresAt })
  })

  router.delete('/:id', async (req, res) => {
    const ok = await usersDb.revokeToken(req.params.id, req.userId)
    if (!ok) { res.status(404).json({ error: 'Token not found' }); return }
    auditRequest(req, 'agent_token.revoked', {
      targetType: 'agent_token',
      targetId:   req.params.id,
    })
    res.json({ ok: true })
  })

  return router
}
