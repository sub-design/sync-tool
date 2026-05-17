import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { randomToken, hashToken } from '../auth'
import { usersDb, jobsDb, logDb, deviceDiagnosticsDb } from '../db'
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
    res.json(await usersDb.listTokens(req.userId, req.orgId))
  })

  router.get('/:id', async (req, res) => {
    const device = await usersDb.getDevice(req.params.id, req.orgId)
    if (!device) { res.status(404).json({ error: 'Device not found' }); return }
    res.json(device)
  })

  router.get('/:id/jobs', async (req, res) => {
    const deviceId = req.params.id
    const allJobs = await jobsDb.listForOrg(req.orgId)
    const deviceJobs = allJobs.filter(j => j.sourceDeviceId === deviceId || j.destinationDeviceId === deviceId)
    res.json(deviceJobs)
  })

  router.get('/:id/sync-history', async (req, res) => {
    const deviceId = req.params.id
    const limit = parseInt(req.query.limit as string) || 50
    
    // Get all jobs for this device
    const allJobs = await jobsDb.listForOrg(req.orgId)
    const deviceJobs = allJobs.filter(j => j.sourceDeviceId === deviceId || j.destinationDeviceId === deviceId)
    
    // Get sync logs for all these jobs
    const allLogs: Array<{ jobId: string; jobName: string; started_at: number }> = []
    for (const job of deviceJobs) {
      const logs = await logDb.list(job.id, limit)
      for (const log of logs) {
        allLogs.push({ ...(log as { started_at: number }), jobId: job.id, jobName: job.name })
      }
    }
    
    // Sort by started_at desc and limit
    allLogs.sort((a, b) => b.started_at - a.started_at)
    res.json(allLogs.slice(0, limit))
  })

  router.get('/:id/diagnostics', async (req, res) => {
    const diagnostics = await deviceDiagnosticsDb.get(req.params.id)
    if (!diagnostics) {
      res.json({ diskDrives: [], endpointChecks: [], jobDiagnostics: [], updatedAt: null })
      return
    }
    res.json(diagnostics)
  })

  router.post('/:id/metadata', async (req, res) => {
    const { os, hostname, ipAddress, agentVersion, lastSeen, status } = req.body
    await usersDb.updateDeviceMetadata(req.params.id, { os, hostname, ipAddress, agentVersion, lastSeen, status })
    res.json({ ok: true })
  })

  router.post('/:id/test-connection', async (req, res) => {
    // TODO: Implement actual connection test via WebSocket to agent
    // For now, return a placeholder response
    res.json({ ok: true, status: 'pending', message: 'Connection test initiated' })
  })

  router.post('/:id/update-client', async (req, res) => {
    // TODO: Implement client update via WebSocket to agent
    // For now, return a placeholder response
    res.json({ ok: true, status: 'pending', message: 'Client update initiated' })
  })

  router.post('/:id/restart-agent', async (req, res) => {
    // TODO: Implement agent restart via WebSocket to agent
    // For now, return a placeholder response
    res.json({ ok: true, status: 'pending', message: 'Agent restart initiated' })
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
    await usersDb.createToken(id, req.userId, name, hashToken(token), expiresAt, undefined, req.orgId)
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

    await usersDb.createToken(id, req.userId, existing.name, hashToken(token), expiresAt, existing.id, req.orgId)
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
