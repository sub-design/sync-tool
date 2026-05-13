import { Router, type Router as ExpressRouter } from 'express'
import { v4 as uuid } from 'uuid'
import { jobsDb, logDb } from '../db'
import { requireAuth } from '../middleware/requireAuth'
import type { ServerToAgent } from '@sync-tool/shared'

export function createJobsRouter(
  broadcast: (msg: ServerToAgent) => void,
  onJobsChanged: () => void = () => {},
): ExpressRouter {
  const router = Router()
  router.use(requireAuth)

  router.get('/', async (req, res) => {
    res.json(await jobsDb.listForUser(req.userId))
  })

  router.get('/:id', async (req, res) => {
    const job = await jobsDb.get(req.params.id)
    if (!job || (await jobsDb.getUserId(req.params.id)) !== req.userId) {
      res.status(404).json({ error: 'Job not found' }); return
    }
    res.json(job)
  })

  router.post('/', async (req, res) => {
    const {
      name, source, destination,
      direction = 'ltr', transferMode = 'auto', reliability = {},
      sourceDeviceId, destinationDeviceId, watch = false, schedule,
    } = req.body
    if (!name || !source || !destination) {
      res.status(400).json({ error: 'name, source, destination are required' }); return
    }
    const job = await jobsDb.create(
      { id: uuid(), name, source, destination, direction, transferMode, reliability, sourceDeviceId, destinationDeviceId, watch: Boolean(watch), schedule },
      req.userId,
    )
    onJobsChanged()
    res.status(201).json(job)
  })

  router.patch('/:id', async (req, res) => {
    if ((await jobsDb.getUserId(req.params.id)) !== req.userId) {
      res.status(404).json({ error: 'Job not found' }); return
    }
    const job = await jobsDb.update(req.params.id, req.body)
    if (!job) { res.status(404).json({ error: 'Job not found' }); return }
    onJobsChanged()
    res.json(job)
  })

  router.delete('/:id', async (req, res) => {
    if ((await jobsDb.getUserId(req.params.id)) !== req.userId) {
      res.status(404).json({ error: 'Job not found' }); return
    }
    const ok = await jobsDb.delete(req.params.id)
    if (!ok) { res.status(404).json({ error: 'Job not found' }); return }
    onJobsChanged()
    res.json({ ok: true })
  })

  router.post('/:id/run', async (req, res) => {
    const job = await jobsDb.get(req.params.id)
    if (!job || (await jobsDb.getUserId(req.params.id)) !== req.userId) {
      res.status(404).json({ error: 'Job not found' }); return
    }
    if (job.status === 'running' || job.status === 'queued') {
      res.status(409).json({ error: 'Job is already running or queued' }); return
    }
    broadcast({ type: 'job:run', job })
    res.json({ ok: true, jobId: job.id })
  })

  router.post('/:id/cancel', async (req, res) => {
    const job = await jobsDb.get(req.params.id)
    if (!job || (await jobsDb.getUserId(req.params.id)) !== req.userId) {
      res.status(404).json({ error: 'Job not found' }); return
    }
    if (job.status !== 'running' && job.status !== 'queued') {
      res.status(409).json({ error: 'Job is not running or queued' }); return
    }
    await jobsDb.setStatus(job.id, 'cancelled')
    broadcast({ type: 'job:cancel', jobId: job.id })
    res.json({ ok: true, jobId: job.id })
  })

  router.get('/:id/log', async (req, res) => {
    if ((await jobsDb.getUserId(req.params.id)) !== req.userId) {
      res.status(404).json({ error: 'Job not found' }); return
    }
    const limit = parseInt(req.query.limit as string) || 20
    res.json(await logDb.list(req.params.id, limit))
  })

  return router
}
