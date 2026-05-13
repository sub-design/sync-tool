import { Router, type Router as ExpressRouter } from 'express'
import { v4 as uuid } from 'uuid'
import { jobsDb, logDb } from '../db'
import type { ServerToAgent } from '@sync-tool/shared'

// agentSockets is injected from index.ts so routes can trigger jobs
export function createJobsRouter(
  broadcast: (msg: ServerToAgent) => void,
  onJobsChanged: () => void = () => {},
): ExpressRouter {
  const router = Router()

  // GET /api/jobs
  router.get('/', (_req, res) => {
    res.json(jobsDb.list())
  })

  // GET /api/jobs/:id
  router.get('/:id', (req, res) => {
    const job = jobsDb.get(req.params.id)
    if (!job) return res.status(404).json({ error: 'Job not found' })
    res.json(job)
  })

  // POST /api/jobs
  router.post('/', (req, res) => {
    const {
      name,
      source,
      destination,
      direction = 'ltr',
      transferMode = 'auto',
	      reliability = {},
	      sourceDeviceId,
	      destinationDeviceId,
	      watch = false,
	      schedule,
    } = req.body
    if (!name || !source || !destination) {
      return res.status(400).json({ error: 'name, source, destination are required' })
    }
    const job = jobsDb.create({
      id: uuid(),
      name,
      source,
      destination,
      direction,
      transferMode,
	      reliability,
	      sourceDeviceId,
	      destinationDeviceId,
	      watch: Boolean(watch),
	      schedule,
	    })
	    onJobsChanged()
	    res.status(201).json(job)
	  })

  // PATCH /api/jobs/:id
	  router.patch('/:id', (req, res) => {
	    const job = jobsDb.update(req.params.id, req.body)
	    if (!job) return res.status(404).json({ error: 'Job not found' })
	    onJobsChanged()
	    res.json(job)
	  })

  // DELETE /api/jobs/:id
	  router.delete('/:id', (req, res) => {
	    const ok = jobsDb.delete(req.params.id)
	    if (!ok) return res.status(404).json({ error: 'Job not found' })
	    onJobsChanged()
	    res.json({ ok: true })
	  })

  // POST /api/jobs/:id/run  — trigger a job immediately
	  router.post('/:id/run', (req, res) => {
	    const job = jobsDb.get(req.params.id)
	    if (!job) return res.status(404).json({ error: 'Job not found' })
	    if (job.status === 'running' || job.status === 'queued') return res.status(409).json({ error: 'Job is already running or queued' })

	    broadcast({ type: 'job:run', job })
	    res.json({ ok: true, jobId: job.id })
	  })

  // POST /api/jobs/:id/cancel — request cancellation for a queued/running job
  router.post('/:id/cancel', (req, res) => {
    const job = jobsDb.get(req.params.id)
    if (!job) return res.status(404).json({ error: 'Job not found' })
    if (job.status !== 'running' && job.status !== 'queued') {
      return res.status(409).json({ error: 'Job is not running or queued' })
    }

    jobsDb.setStatus(job.id, 'cancelled')
    broadcast({ type: 'job:cancel', jobId: job.id })
    res.json({ ok: true, jobId: job.id })
  })

  // GET /api/jobs/:id/log
  router.get('/:id/log', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 20
    res.json(logDb.list(req.params.id, limit))
  })

  return router
}
