import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { randomToken, hashToken } from '../auth'
import { usersDb } from '../db'
import { requireAuth } from '../middleware/requireAuth'
import { createRateLimiter, rateLimitIp } from '../rateLimit'

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
    const { name } = req.body
    if (!name) { res.status(400).json({ error: 'name is required' }); return }
    const id    = uuid()
    const token = randomToken()
    await usersDb.createToken(id, req.userId, name, hashToken(token))
    res.status(201).json({ id, name, token })
  })

  router.delete('/:id', async (req, res) => {
    const ok = await usersDb.deleteToken(req.params.id, req.userId)
    if (!ok) { res.status(404).json({ error: 'Token not found' }); return }
    res.json({ ok: true })
  })

  return router
}
