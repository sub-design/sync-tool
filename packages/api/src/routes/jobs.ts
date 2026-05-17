import { Router, type Router as ExpressRouter } from 'express'
import { v4 as uuid } from 'uuid'
import { jobsDb, logDb, endpointsDb } from '../db'
import { requireAuth } from '../middleware/requireAuth'
import { auditRequest } from '../audit'
import { buildEndpointUri } from './endpoints'
import type { Job, ServerToAgent } from '@sync-tool/shared'

/** Resolve sourceEndpointId / destinationEndpointId → real URIs, server-side. */
async function resolveEndpoints(
  userId: string,
  source: string,
  destination: string,
  sourceEndpointId?: string,
  destinationEndpointId?: string,
  orgId?: string,
): Promise<{ source: string; destination: string }> {
  let resolvedSource = source
  let resolvedDest   = destination

  if (sourceEndpointId) {
    const ep = await endpointsDb.get(sourceEndpointId, userId, orgId)
    if (!ep) throw Object.assign(new Error('Source endpoint not found'), { status: 400 })
    resolvedSource = buildEndpointUri(ep)
  }
  if (destinationEndpointId) {
    const ep = await endpointsDb.get(destinationEndpointId, userId, orgId)
    if (!ep) throw Object.assign(new Error('Destination endpoint not found'), { status: 400 })
    resolvedDest = buildEndpointUri(ep)
  }

  return { source: resolvedSource, destination: resolvedDest }
}

/** Return a job with endpoint URIs resolved fresh from the DB (used at run time). */
async function withResolvedEndpoints(job: Job, userId: string, orgId?: string): Promise<Job> {
  if (!job.sourceEndpointId && !job.destinationEndpointId) return job
  const { source, destination } = await resolveEndpoints(
    userId, job.source, job.destination,
    job.sourceEndpointId, job.destinationEndpointId,
    orgId,
  )
  return { ...job, source, destination }
}

export function createJobsRouter(
  broadcast:        (msg: ServerToAgent) => void,
  sendToAgent:      (deviceId: string, msg: ServerToAgent) => boolean,
  pendingRollbacks: Map<string, number>,
  onJobsChanged:    () => void = () => {},
): ExpressRouter {
  const router = Router()
  router.use(requireAuth)

  router.get('/', async (req, res) => {
    res.json(await jobsDb.listForOrg(req.orgId))
  })

  router.get('/:id', async (req, res) => {
    const job = await jobsDb.get(req.params.id)
    if (!job || job.orgId !== req.orgId) {
      res.status(404).json({ error: 'Job not found' }); return
    }
    res.json(job)
  })

  router.post('/', async (req, res) => {
    const {
      name, source = '', destination = '',
      sourceEndpointId, destinationEndpointId,
      direction = 'ltr', jobMode = 'sync', transferMode = 'auto', deletionPolicy = 'backup', reliability = {},
      filters = {}, destinationLayout = 'byCaptureDate', dateSource = 'exifThenMtime', collisionPolicy = 'skipSameErrorDifferent',
      templateId, sourceDeviceId, destinationDeviceId, watch = false, schedule, autoOptions = {},
    } = req.body
    if (!name) { res.status(400).json({ error: 'name is required' }); return }
    if (!source && !sourceEndpointId) {
      res.status(400).json({ error: 'source or sourceEndpointId is required' }); return
    }
    if (!destination && !destinationEndpointId) {
      res.status(400).json({ error: 'destination or destinationEndpointId is required' }); return
    }
    let resolved: { source: string; destination: string }
    try {
      resolved = await resolveEndpoints(req.userId, source, destination, sourceEndpointId, destinationEndpointId, req.orgId)
    } catch (err: unknown) {
      res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message }); return
    }
    const job = await jobsDb.create(
      {
        id: uuid(), name, source: resolved.source, destination: resolved.destination,
        direction, jobMode, transferMode, deletionPolicy,
        reliability: { encryptionEnabled: true, ...reliability },
        filters, destinationLayout, dateSource, collisionPolicy, templateId,
        sourceDeviceId, destinationDeviceId,
        sourceEndpointId: sourceEndpointId ?? undefined,
        destinationEndpointId: destinationEndpointId ?? undefined,
        watch: Boolean(watch), schedule, autoOptions,
      },
      req.userId,
      req.orgId,
    )
    onJobsChanged()
    auditRequest(req, 'job.created', {
      targetType: 'job',
      targetId:   job.id,
      metadata:   { name: job.name, jobMode, templateId, sourceDeviceId, destinationDeviceId, sourceEndpointId, destinationEndpointId, watch: Boolean(watch), schedule, autoOptions, filters, destinationLayout, dateSource, collisionPolicy },
    })
    res.status(201).json(job)
  })

  router.patch('/:id', async (req, res) => {
    const existing0 = await jobsDb.get(req.params.id)
    if (!existing0 || existing0.orgId !== req.orgId) {
      res.status(404).json({ error: 'Job not found' }); return
    }
    const patch = { ...req.body }
    // Re-resolve endpoints if they changed
    if (patch.sourceEndpointId !== undefined || patch.destinationEndpointId !== undefined || patch.source !== undefined || patch.destination !== undefined) {
      const existing = existing0
      try {
        const resolved = await resolveEndpoints(
          req.userId,
          patch.source      ?? existing.source,
          patch.destination ?? existing.destination,
          patch.sourceEndpointId      !== undefined ? patch.sourceEndpointId      : existing.sourceEndpointId,
          patch.destinationEndpointId !== undefined ? patch.destinationEndpointId : existing.destinationEndpointId,
          req.orgId,
        )
        patch.source      = resolved.source
        patch.destination = resolved.destination
      } catch (err: unknown) {
        res.status((err as { status?: number }).status ?? 400).json({ error: (err as Error).message }); return
      }
    }
    const job = await jobsDb.update(req.params.id, patch)
    if (!job) { res.status(404).json({ error: 'Job not found' }); return }
    onJobsChanged()
    auditRequest(req, 'job.updated', {
      targetType: 'job',
      targetId:   job.id,
      metadata:   { fields: Object.keys(req.body ?? {}) },
    })
    res.json(job)
  })

  router.delete('/:id', async (req, res) => {
    const jobToDel = await jobsDb.get(req.params.id)
    if (!jobToDel || jobToDel.orgId !== req.orgId) {
      res.status(404).json({ error: 'Job not found' }); return
    }
    const ok = await jobsDb.delete(req.params.id)
    if (!ok) { res.status(404).json({ error: 'Job not found' }); return }
    onJobsChanged()
    auditRequest(req, 'job.deleted', {
      targetType: 'job',
      targetId:   req.params.id,
    })
    res.json({ ok: true })
  })

  router.post('/:id/run', async (req, res) => {
    const job = await jobsDb.get(req.params.id)
    if (!job || job.orgId !== req.orgId) {
      res.status(404).json({ error: 'Job not found' }); return
    }
    if (job.status === 'running' || job.status === 'queued') {
      res.status(409).json({ error: 'Job is already running or queued' }); return
    }
    // Re-resolve named endpoint configs at run time so changes to an endpoint
    // propagate to all jobs that reference it without requiring a job edit.
    const resolvedJob = await withResolvedEndpoints(job, req.userId, req.orgId)
    broadcast({ type: 'job:run', job: resolvedJob })
    auditRequest(req, 'job.run_requested', {
      targetType: 'job',
      targetId:   job.id,
      metadata:   { name: job.name },
    })
    res.json({ ok: true, jobId: job.id })
  })

  router.post('/:id/cancel', async (req, res) => {
    const job = await jobsDb.get(req.params.id)
    if (!job || job.orgId !== req.orgId) {
      res.status(404).json({ error: 'Job not found' }); return
    }
    if (job.status !== 'running' && job.status !== 'queued') {
      res.status(409).json({ error: 'Job is not running or queued' }); return
    }
    await jobsDb.setStatus(job.id, 'cancelled')
    broadcast({ type: 'job:cancel', jobId: job.id })
    auditRequest(req, 'job.cancel_requested', {
      targetType: 'job',
      targetId:   job.id,
    })
    res.json({ ok: true, jobId: job.id })
  })

  router.get('/:id/log', async (req, res) => {
    const jobLog = await jobsDb.get(req.params.id)
    if (!jobLog || jobLog.orgId !== req.orgId) {
      res.status(404).json({ error: 'Job not found' }); return
    }
    const limit = parseInt(req.query.limit as string) || 20
    res.json(await logDb.list(req.params.id, limit))
  })

  // ── Rollback ──────────────────────────────────────────────────────────────────

  router.get('/:id/log/:logId/rollback', async (req, res) => {
    const jobRb = await jobsDb.get(req.params.id)
    if (!jobRb || jobRb.orgId !== req.orgId) {
      res.status(404).json({ error: 'Job not found' }); return
    }
    const logId = parseInt(req.params.logId)
    if (isNaN(logId)) { res.status(400).json({ error: 'Invalid logId' }); return }

    const data = await logDb.getRollbackManifest(logId)
    if (!data) { res.status(404).json({ error: 'No rollback data for this log entry' }); return }
    if (data.status !== 'available') {
      res.status(409).json({ error: `Rollback is ${data.status}` }); return
    }

    res.json({
      logId,
      status:         data.status,
      totalFiles:     data.manifest.entries.length,
      filesToRestore: data.manifest.entries
        .filter(e => e.action !== 'created')
        .map(e => ({ relativePath: e.relativePath, action: e.action, prevSize: e.prevSize })),
      filesToDelete: data.manifest.entries
        .filter(e => e.action === 'created')
        .map(e => ({ relativePath: e.relativePath })),
    })
  })

  router.post('/:id/log/:logId/rollback', async (req, res) => {
    const job = await jobsDb.get(req.params.id)
    if (!job || job.orgId !== req.orgId) {
      res.status(404).json({ error: 'Job not found' }); return
    }
    if (job.status === 'running' || job.status === 'queued') {
      res.status(409).json({ error: 'Cannot rollback while job is running' }); return
    }

    const logId = parseInt(req.params.logId)
    if (isNaN(logId)) { res.status(400).json({ error: 'Invalid logId' }); return }

    const data = await logDb.getRollbackManifest(logId)
    if (!data) { res.status(404).json({ error: 'No rollback data for this log entry' }); return }
    if (data.status !== 'available') {
      res.status(409).json({ error: `Rollback is ${data.status}` }); return
    }

    const claimed = await logDb.markRollbackUsed(logId)
    if (!claimed) { res.status(409).json({ error: 'Rollback already in progress or used' }); return }

    const sent = sendToAgent(data.deviceId, {
      type:     'job:rollback',
      job,
      logId:    String(logId),
      manifest: data.manifest,
    })

    if (!sent) {
      await logDb.resetRollbackToAvailable(logId)
      res.status(502).json({ error: 'Agent is offline — rollback data is still available' }); return
    }

    pendingRollbacks.set(job.id, logId)
    auditRequest(req, 'job.rollback_requested', {
      targetType: 'job',
      targetId:   job.id,
      metadata:   { logId, deviceId: data.deviceId },
    })
    res.json({ ok: true, logId })
  })

  return router
}
