import { Router, type Router as ExpressRouter } from 'express'
import { auditDb } from '../db'
import { requireAuth } from '../middleware/requireAuth'

export function createAuditRouter(): ExpressRouter {
  const router = Router()
  router.use(requireAuth)

  router.get('/', async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100
    res.json(await auditDb.listForUser(req.userId, limit))
  })

  return router
}
