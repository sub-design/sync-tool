import { Router } from 'express'
import { analyticsDb } from '../db.js'
import { requireAuth } from '../middleware/requireAuth.js'

export function createAnalyticsRouter(): Router {
  const router = Router()
  router.use(requireAuth)

  /**
   * GET /api/analytics?days=30
   * Returns summary + daily activity + per-job breakdown for the current org.
   */
  router.get('/', async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365)
    const orgId = req.orgId

    const [summary, dailyActivity, byJob] = await Promise.all([
      analyticsDb.summary(orgId, days),
      analyticsDb.dailyActivity(orgId, days),
      analyticsDb.byJob(orgId, days),
    ])

    res.json({ summary, dailyActivity, byJob })
  })

  return router
}
