import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { initDb, jobsDb, logDb, usersDb, type SyncLogFile } from './db'
import { createJobsRouter } from './routes/jobs'
import { createAuthRouter } from './routes/auth'
import { createDevicesRouter } from './routes/devices'
import { createAuditRouter } from './routes/audit'
import { createEndpointsRouter } from './routes/endpoints'
import { createJobTemplatesRouter } from './routes/jobTemplates'
import { createCollectionsRouter } from './routes/collections'
import { createOrgsRouter } from './routes/orgs'
import { createAnalyticsRouter } from './routes/analytics'
import { authFromWsRequest, requireAuth } from './middleware/requireAuth'
import { hitRateLimit } from './rateLimit'
import { auditRequest, auditSystem } from './audit'
import { notifyJob } from './notifications'
import { schedulerPollMs, shouldRunInterval, shouldRunNow } from './scheduler'
import { canTriggerJob, type QueueReason } from './triggers'
import type { AgentToServer, ServerToAgent, ServerToBrowser, Job, DirEntry } from '@sync-tool/shared'

const PORT = parseInt(process.env.PORT ?? '3001', 10)

// ── Express app ───────────────────────────────────────────────────────────────

const app = express()
app.use(cors())
app.use(express.json())
app.use((req, res, next) => {
  if (!secureTransportRequired() || requestArrivedSecurely(req)) {
    next()
    return
  }
  res.status(403).json({ error: 'Secure transport required' })
})

// ── WebSocket servers ─────────────────────────────────────────────────────────

const server = http.createServer(app)
const agentWss   = new WebSocketServer({ noServer: true })
const browserWss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  if (secureTransportRequired() && !upgradeArrivedSecurely(req)) {
    auditSystem('transport.rejected', {
      actorType:  'network',
      ip:         wsRateLimitAddress(req),
      userAgent:  req.headers['user-agent'],
      metadata:   { url: req.url, reason: 'insecure_transport' },
    })
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    socket.destroy()
    return
  }

  const authKey = `ws-auth:${wsRateLimitAddress(req)}`
  if (hitRateLimit(authKey, 15 * 60_000, 60)) {
    auditSystem('ws.rate_limited', {
      actorType: 'network',
      ip:        wsRateLimitAddress(req),
      userAgent: req.headers['user-agent'],
      metadata:  { url: req.url },
    })
    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n')
    socket.destroy()
    return
  }

  authFromWsRequest(req).then((auth) => {
    if (!auth) {
      auditSystem('ws.auth_failed', {
        actorType: 'anonymous',
        ip:        wsRateLimitAddress(req),
        userAgent: req.headers['user-agent'],
        metadata:  { path: req.url?.split('?')[0] },
      })
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    if (req.url?.startsWith('/agent')) {
      agentWss.handleUpgrade(req, socket, head, (ws) => agentWss.emit('connection', ws, req, auth))
    } else {
      browserWss.handleUpgrade(req, socket, head, (ws) => browserWss.emit('connection', ws, req, auth))
    }
  }).catch(() => {
    socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
    socket.destroy()
  })
})

function secureTransportRequired(): boolean {
  return process.env.REQUIRE_SECURE_TRANSPORT === 'true'
}

function requestArrivedSecurely(req: express.Request): boolean {
  return isLocalAddress(req.socket.remoteAddress) || forwardedProto(req).some(isSecureProto)
}

function upgradeArrivedSecurely(req: http.IncomingMessage): boolean {
  return isLocalAddress(req.socket.remoteAddress) || forwardedProto(req).some(isSecureProto)
}

function forwardedProto(req: express.Request | http.IncomingMessage): string[] {
  const raw = req.headers['x-forwarded-proto']
  const values = Array.isArray(raw) ? raw : [raw]
  return values
    .filter((value): value is string => typeof value === 'string')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toLowerCase())
}

function isSecureProto(proto: string): boolean {
  return proto === 'https' || proto === 'wss'
}

function isLocalAddress(address: string | undefined): boolean {
  return !address || address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function wsRateLimitAddress(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]
  return (firstForwarded || req.socket.remoteAddress || 'unknown').trim()
}

function toIntegerMs(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
}

// ── Agent registry ────────────────────────────────────────────────────────────

interface AgentConn {
  ws: WebSocket; userId: string; orgId?: string; deviceId: string; hostname: string; platform: string
}

const agents = new Map<string, AgentConn>()

// jobId -> deviceId for jobs that have been dispatched to an agent and have not
// reached a terminal state yet.
const activeJobOwners = new Map<string, string>()

// jobId → logId for in-flight rollbacks (correlates agent response with DB row)
const pendingRollbacks = new Map<string, number>()

// jobId → file events buffered during a sync run (flushed on job:complete)
const inFlightFiles = new Map<string, SyncLogFile[]>()

// ── Pending browse requests ────────────────────────────────────────────────────

interface BrowsePending {
  resolve: (result: { path: string; entries: DirEntry[]; error?: string }) => void
  timer:   ReturnType<typeof setTimeout>
}
const browsePending = new Map<string, BrowsePending>()

interface BrowseCreateFolderPending {
  resolve: (result: { path: string; error?: string }) => void
  timer:   ReturnType<typeof setTimeout>
}
const browseCreateFolderPending = new Map<string, BrowseCreateFolderPending>()

function sendToAgent(deviceId: string, msg: ServerToAgent): boolean {
  const conn = agents.get(deviceId)
  if (!conn || conn.ws.readyState !== WebSocket.OPEN) return false
  conn.ws.send(JSON.stringify(msg))
  return true
}

function initiatingDeviceId(job: Job): string | undefined {
  if (!job.sourceDeviceId || !job.destinationDeviceId) return undefined
  return job.direction === 'rtl' ? job.destinationDeviceId : job.sourceDeviceId
}

async function broadcastJobRun(job: Job): Promise<boolean> {
  const target = initiatingDeviceId(job)
  if (target) {
    if (!sendToAgent(target, { type: 'job:run', job })) {
      console.warn(`[api] Target agent ${target} offline — job ${job.id} not dispatched`)
      return false
    }
    activeJobOwners.set(job.id, target)
    return true
  }
  for (const [, conn] of agents) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify({ type: 'job:run', job } satisfies ServerToAgent))
      activeJobOwners.set(job.id, conn.deviceId)
      return true
    }
  }
  console.warn(`[api] No agents online — job ${job.id} not dispatched`)
  return false
}

async function queueJob(job: Job, reason: QueueReason): Promise<boolean> {
  if (job.status === 'running' || job.status === 'queued') return false
  await jobsDb.setStatus(job.id, 'queued')
  const queued = { ...job, status: 'queued' as const }
  const dispatched = await broadcastJobRun(queued)
  if (!dispatched) {
    const error = initiatingDeviceId(job)
      ? 'Target agent is offline'
      : 'No agent connected'
    await jobsDb.setStatus(job.id, 'error', error)
    await logDb.fail(job.id, error)
    broadcastToBrowsers({ type: 'job:error', jobId: job.id, error }, await jobsDb.getUserId(job.id))
    return false
  }
  broadcastToBrowsers({ type: 'job:status', jobId: job.id, status: 'queued' })
  console.log(`[api] Job ${job.id} queued by ${reason}`)
  return true
}

function broadcastJobCancel(jobId: string) {
  for (const [, conn] of agents) {
    if (conn.ws.readyState === WebSocket.OPEN)
      conn.ws.send(JSON.stringify({ type: 'job:cancel', jobId } satisfies ServerToAgent))
  }
}

async function sendWatchConfig(conn: AgentConn): Promise<void> {
  if (conn.ws.readyState !== WebSocket.OPEN) return
  const all  = conn.orgId
    ? await jobsDb.listForOrg(conn.orgId)
    : await jobsDb.listForUser(conn.userId)
  const jobs = all.filter((j) => j.watch || j.autoOptions?.onFolderConnect)
  conn.ws.send(JSON.stringify({ type: 'jobs:watch', jobs } satisfies ServerToAgent))
}

async function broadcastWatchConfig(): Promise<void> {
  for (const [, conn] of agents) await sendWatchConfig(conn)
}

// ── Browser connections (user-scoped) ─────────────────────────────────────────

const browserConnections = new Map<WebSocket, string>()

function broadcastToBrowsers(msg: ServerToBrowser, userId?: string) {
  const payload = JSON.stringify(msg)
  for (const [ws, uid] of browserConnections) {
    if (userId && uid !== userId) continue
    if (ws.readyState === WebSocket.OPEN) ws.send(payload)
  }
}

// ── Agent WebSocket ───────────────────────────────────────────────────────────

agentWss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, auth: { userId: string; orgId?: string; deviceId?: string }) => {
  const { userId, orgId } = auth
  let deviceId = ''

  ws.on('message', async (raw) => {
    let msg: AgentToServer
    try { msg = JSON.parse(raw.toString()) } catch { return }

    switch (msg.type) {
      case 'register': {
        deviceId = auth.deviceId ?? msg.deviceId
        agents.set(deviceId, { ws, userId, orgId, deviceId, hostname: msg.hostname, platform: msg.platform })
        void usersDb.updateDeviceMetadata(deviceId, {
          hostname: msg.hostname,
          os:       msg.platform,
          lastSeen: Date.now(),
          status:   'online',
        })
        ws.send(JSON.stringify({ type: 'registered', ok: true } satisfies ServerToAgent))
        broadcastToBrowsers({ type: 'agent:online', deviceId, hostname: msg.hostname }, userId)
        auditSystem('agent.connected', {
          userId,
          actorType:  'agent',
          actorId:    deviceId,
          targetType: 'device',
          targetId:   deviceId,
          metadata:   { hostname: msg.hostname, platform: msg.platform, orgId },
        })
        console.log(`[api] Agent registered: ${msg.hostname} (${deviceId})`)
        await sendWatchConfig(agents.get(deviceId)!)
        const all    = orgId ? await jobsDb.listForOrg(orgId) : await jobsDb.listForUser(userId)
        const queued = all.filter((j) => j.status === 'queued')
        for (const job of queued) ws.send(JSON.stringify({ type: 'job:run', job } satisfies ServerToAgent))
        for (const job of queued) activeJobOwners.set(job.id, deviceId)
        break
      }
      case 'job:progress': {
        const job = await jobsDb.get(msg.progress.jobId)
        const jUid = job ? await jobsDb.getUserId(job.id) : undefined
        broadcastToBrowsers({ type: 'job:progress', progress: msg.progress }, jUid)
        break
      }
      case 'job:file:done': {
        const buf = inFlightFiles.get(msg.jobId) ?? []
        buf.push({
          run_id:        0,  // placeholder; replaced when run is created on job:complete
          relative_path: msg.file.relativePath,
          is_directory:  msg.file.isDirectory,
          action:        msg.file.action,
          size:          msg.file.size,
          mtime_ms:      toIntegerMs(msg.file.mtimeMs),
          error_msg:     msg.file.errorMsg ?? null,
        })
        inFlightFiles.set(msg.jobId, buf)
        const jUid = await jobsDb.getUserId(msg.jobId)
        broadcastToBrowsers({ type: 'job:file:done', jobId: msg.jobId, file: msg.file }, jUid)
        break
      }
      case 'job:trigger': {
        const job = await jobsDb.get(msg.jobId)
        if (canTriggerJob(job, msg.reason)) await queueJob(job, msg.reason)
        break
      }
      case 'job:started': {
        await jobsDb.setStatus(msg.jobId, 'running')
        const jUid = await jobsDb.getUserId(msg.jobId)
        broadcastToBrowsers({ type: 'job:status', jobId: msg.jobId, status: 'running' }, jUid)
        break
      }
      case 'job:complete': {
        const { result } = msg
        const job  = await jobsDb.get(result.jobId)
        const jUid = await jobsDb.getUserId(result.jobId)
        activeJobOwners.delete(result.jobId)
        await jobsDb.setStatus(result.jobId, 'completed')
        const logId = await logDb.create(result.jobId)
        await logDb.complete(logId, result)
        if (result.rollbackManifest && deviceId) {
          await logDb.saveRollbackManifest(logId, result.rollbackManifest, deviceId)
        }
        const files = inFlightFiles.get(result.jobId)
        inFlightFiles.delete(result.jobId)
        if (files && files.length > 0) {
          void logDb.insertFiles(logId, files.map(f => ({ ...f, run_id: logId })))
        }
        broadcastToBrowsers({ type: 'job:complete', result }, jUid)
        void notifyJob(job, { status: 'completed', result })
        console.log(`[api] Job ${result.jobId} completed — ${result.filesCopied} copied, ${result.filesDeleted ?? 0} deleted`)
        break
      }
      case 'job:cancelled': {
        const job  = await jobsDb.get(msg.jobId)
        const jUid = await jobsDb.getUserId(msg.jobId)
        activeJobOwners.delete(msg.jobId)
        await jobsDb.setStatus(msg.jobId, 'cancelled')
        await logDb.cancel(msg.jobId)
        inFlightFiles.delete(msg.jobId)
        broadcastToBrowsers({ type: 'job:cancelled', jobId: msg.jobId }, jUid)
        void notifyJob(job, { status: 'cancelled', jobId: msg.jobId })
        break
      }
      case 'job:error': {
        const job  = await jobsDb.get(msg.jobId)
        const jUid = await jobsDb.getUserId(msg.jobId)
        activeJobOwners.delete(msg.jobId)
        await jobsDb.setStatus(msg.jobId, 'error', msg.error)
        await logDb.fail(msg.jobId, msg.error)
        inFlightFiles.delete(msg.jobId)
        broadcastToBrowsers({ type: 'job:error', jobId: msg.jobId, error: msg.error }, jUid)
        void notifyJob(job, { status: 'error', jobId: msg.jobId, error: msg.error })
        console.error(`[api] Job ${msg.jobId} failed: ${msg.error}`)
        break
      }

      case 'browse:result': {
        const pending = browsePending.get(msg.requestId)
        if (pending) {
          clearTimeout(pending.timer)
          browsePending.delete(msg.requestId)
          pending.resolve({ path: msg.path, entries: msg.entries, error: msg.error })
        }
        break
      }

      case 'browse:create-folder:result': {
        const pending = browseCreateFolderPending.get(msg.requestId)
        if (pending) {
          clearTimeout(pending.timer)
          browseCreateFolderPending.delete(msg.requestId)
          pending.resolve({ path: msg.path, error: msg.error })
        }
        break
      }

      case 'job:rollback:progress': {
        const jUid = await jobsDb.getUserId(msg.jobId)
        broadcastToBrowsers({
          type:          'job:rollback:progress',
          jobId:         msg.jobId,
          filesRestored: msg.filesRestored,
          filesTotal:    msg.filesTotal,
          currentFile:   msg.currentFile,
        }, jUid)
        break
      }

      case 'job:rollback:complete': {
        const jUid  = await jobsDb.getUserId(msg.jobId)
        const logId = pendingRollbacks.get(msg.jobId)
        if (logId !== undefined) {
          await logDb.createRollbackRun(msg.jobId, logId, msg.result)
          pendingRollbacks.delete(msg.jobId)
        }
        await jobsDb.setStatus(msg.jobId, 'completed')
        broadcastToBrowsers({
          type:   'job:rollback:complete',
          jobId:  msg.jobId,
          logId:  String(logId ?? ''),
          result: msg.result,
        }, jUid)
        console.log(`[api] Rollback for job ${msg.jobId} complete — ${msg.result.filesRestored} restored`)
        break
      }

      case 'job:rollback:error': {
        const jUid = await jobsDb.getUserId(msg.jobId)
        const logId = pendingRollbacks.get(msg.jobId)
        if (logId !== undefined) {
          // Re-mark as available so user can retry
          await logDb.resetRollbackToAvailable(logId)
          pendingRollbacks.delete(msg.jobId)
        }
        broadcastToBrowsers({
          type:  'job:rollback:error',
          jobId: msg.jobId,
          logId: String(logId ?? ''),
          error: msg.error,
        }, jUid)
        console.error(`[api] Rollback for job ${msg.jobId} failed: ${msg.error}`)
        break
      }
    }
  })

  ws.on('close', () => {
    if (deviceId) {
      const conn = agents.get(deviceId)
      agents.delete(deviceId)
      void usersDb.updateDeviceMetadata(deviceId, { lastSeen: Date.now(), status: 'offline' })
      broadcastToBrowsers({ type: 'agent:offline', deviceId }, conn?.userId)
      void markOwnedJobsFailed(deviceId, 'Agent disconnected before the job finished')
      auditSystem('agent.disconnected', {
        userId:     conn?.userId,
        actorType:  'agent',
        actorId:    deviceId,
        targetType: 'device',
        targetId:   deviceId,
      })
      console.log(`[api] Agent disconnected: ${deviceId}`)
    }
  })
})

async function markOwnedJobsFailed(deviceId: string, error: string): Promise<void> {
  const ownedJobIds = [...activeJobOwners.entries()]
    .filter(([, ownerDeviceId]) => ownerDeviceId === deviceId)
    .map(([jobId]) => jobId)

  for (const jobId of ownedJobIds) {
    activeJobOwners.delete(jobId)
    const job = await jobsDb.get(jobId)
    if (!job || (job.status !== 'running' && job.status !== 'queued')) continue

    const jUid = await jobsDb.getUserId(jobId)
    await jobsDb.setStatus(jobId, 'error', error)
    await logDb.fail(jobId, error)
    inFlightFiles.delete(jobId)
    broadcastToBrowsers({ type: 'job:error', jobId, error }, jUid)
    void notifyJob(job, { status: 'error', jobId, error })
    console.warn(`[api] Job ${jobId} failed: ${error}`)
  }
}

async function recoverInterruptedJobs(): Promise<void> {
  const error = 'API restarted before the job finished'
  const activeJobs = (await jobsDb.list()).filter((job) => job.status === 'running' || job.status === 'queued')

  for (const job of activeJobs) {
    const jUid = await jobsDb.getUserId(job.id)
    await jobsDb.setStatus(job.id, 'error', error)
    await logDb.fail(job.id, error)
    inFlightFiles.delete(job.id)
    activeJobOwners.delete(job.id)
    broadcastToBrowsers({ type: 'job:error', jobId: job.id, error }, jUid)
    void notifyJob(job, { status: 'error', jobId: job.id, error })
    console.warn(`[api] Recovered interrupted job ${job.id}: ${error}`)
  }
}

// ── Browser WebSocket ─────────────────────────────────────────────────────────

browserWss.on('connection', async (ws: WebSocket, _req: http.IncomingMessage, auth: { userId: string; orgId?: string }) => {
  const { userId } = auth
  browserConnections.set(ws, userId)
  for (const [, conn] of agents) {
    if (conn.userId !== userId) continue
    ws.send(JSON.stringify({ type: 'agent:online', deviceId: conn.deviceId, hostname: conn.hostname } satisfies ServerToBrowser))
  }
  ws.on('close', () => browserConnections.delete(ws))
})

// ── Cron scheduler ────────────────────────────────────────────────────────────

async function checkScheduledJobs(): Promise<void> {
  const now = new Date()
  for (const job of await jobsDb.list()) {
    if (job.status === 'running' || job.status === 'queued') continue
    const cronDue = job.schedule ? shouldRunNow(job.schedule, now, job.lastRun) : false
    const intervalDue = shouldRunInterval(job.autoOptions?.periodicEveryMinutes, now, job.lastRun, job.createdAt)
    if (cronDue || intervalDue) await queueJob(job, 'schedule')
  }
}

async function queueStartupJobs(): Promise<void> {
  for (const job of await jobsDb.list()) {
    if (job.autoOptions?.onStart) await queueJob(job, 'startup')
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/api/auth',      createAuthRouter())
app.use('/api/orgs',      createOrgsRouter())
app.use('/api/analytics', createAnalyticsRouter())
app.use('/api/devices',   createDevicesRouter())
app.use('/api/audit',     createAuditRouter())
app.use('/api/endpoints', createEndpointsRouter())
app.use('/api/job-templates', createJobTemplatesRouter())
app.use('/api/collections',  createCollectionsRouter())
app.get('/api/relay-config', requireAuth, (req, res) => {
  const relayUrl = relayUrlForRequest(req)
  res.json({
    enabled: Boolean(relayUrl && process.env.MANAGED_RELAY_TOKEN),
    relayUrl,
    relayToken: relayUrl ? process.env.MANAGED_RELAY_TOKEN ?? '' : '',
  })
})
app.use('/api/jobs',    createJobsRouter(
  async (msg, reason = 'manual') => {
    if (msg.type === 'job:run') return await queueJob(msg.job, reason)
    if (msg.type === 'job:cancel') {
      broadcastJobCancel(msg.jobId)
      broadcastToBrowsers({ type: 'job:cancelled', jobId: msg.jobId })
      return true
    }
    return false
  },
  sendToAgent,
  pendingRollbacks,
  () => { void broadcastWatchConfig() },
))

app.get('/api/runs/:runId/files', requireAuth, async (req, res) => {
  const runId = parseInt(req.params.runId, 10)
  if (isNaN(runId)) { res.status(400).json({ error: 'Invalid runId' }); return }
  const files = await logDb.getFiles(runId)
  res.json(files)
})

app.get('/api/browse', requireAuth, async (req, res) => {
  const userId   = req.userId
  const deviceId = req.query.deviceId as string | undefined
  const browsePath = (req.query.path as string | undefined) ?? '~'

  // Find target agent (must belong to same user)
  const target = deviceId
    ? agents.get(deviceId)
    : [...agents.values()].find(a => a.userId === userId)

  if (!target || target.userId !== userId) {
    auditRequest(req, 'browse.rejected', {
      targetType: 'device',
      targetId:   deviceId,
      metadata:   { path: browsePath, reason: 'agent_not_found_or_offline' },
    })
    res.status(404).json({ error: 'Agent not found or offline' })
    return
  }

  const requestId = `browse_${Date.now()}_${Math.random().toString(36).slice(2)}`

  const result = await new Promise<{ path: string; entries: DirEntry[]; error?: string }>((resolve) => {
    const timer = setTimeout(() => {
      browsePending.delete(requestId)
      resolve({ path: browsePath, entries: [], error: 'Agent did not respond in time' })
    }, 10_000)
    browsePending.set(requestId, { resolve, timer })
    target.ws.send(JSON.stringify({ type: 'browse:request', requestId, path: browsePath } satisfies ServerToAgent))
  })

  if (result.error) {
    auditRequest(req, 'browse.failed', {
      targetType: 'device',
      targetId:   target.deviceId,
      metadata:   { path: browsePath, error: result.error },
    })
    res.status(502).json({ error: result.error })
    return
  }
  auditRequest(req, 'browse.succeeded', {
    targetType: 'device',
    targetId:   target.deviceId,
    metadata:   { path: browsePath, resolvedPath: result.path, entries: result.entries.length },
  })
  res.json({ path: result.path, entries: result.entries })
})

app.post('/api/browse/folder', requireAuth, async (req, res) => {
  const userId     = req.userId
  const deviceId   = req.body?.deviceId as string | undefined
  const parentPath = (req.body?.path as string | undefined) ?? '~'
  const name       = (req.body?.name as string | undefined)?.trim() ?? ''

  if (!isValidFolderName(name)) {
    res.status(400).json({ error: 'Invalid folder name' })
    return
  }

  const target = deviceId
    ? agents.get(deviceId)
    : [...agents.values()].find(a => a.userId === userId)

  if (!target || target.userId !== userId) {
    auditRequest(req, 'browse.create_folder.rejected', {
      targetType: 'device',
      targetId:   deviceId,
      metadata:   { path: parentPath, name, reason: 'agent_not_found_or_offline' },
    })
    res.status(404).json({ error: 'Agent not found or offline' })
    return
  }

  const requestId = `browse_mkdir_${Date.now()}_${Math.random().toString(36).slice(2)}`

  const result = await new Promise<{ path: string; error?: string }>((resolve) => {
    const timer = setTimeout(() => {
      browseCreateFolderPending.delete(requestId)
      resolve({ path: parentPath, error: 'Agent did not respond in time' })
    }, 10_000)
    browseCreateFolderPending.set(requestId, { resolve, timer })
    target.ws.send(JSON.stringify({
      type: 'browse:create-folder',
      requestId,
      parentPath,
      name,
    } satisfies ServerToAgent))
  })

  if (result.error) {
    auditRequest(req, 'browse.create_folder.failed', {
      targetType: 'device',
      targetId:   target.deviceId,
      metadata:   { path: parentPath, name, error: result.error },
    })
    res.status(502).json({ error: result.error })
    return
  }

  auditRequest(req, 'browse.create_folder.succeeded', {
    targetType: 'device',
    targetId:   target.deviceId,
    metadata:   { path: parentPath, name, createdPath: result.path },
  })
  res.status(201).json({ path: result.path })
})

function isValidFolderName(name: string): boolean {
  return !!name && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\') && !name.includes('\0')
}

function relayUrlForRequest(req: express.Request): string {
  const configured = (process.env.MANAGED_RELAY_URL ?? '').trim()
  if (configured) return configured.replace(/\/$/, '')

  if (process.env.MANAGED_RELAY_SAME_HOST !== 'true') return ''
  const host = req.get('host')
  if (!host) return ''
  const secure = requestArrivedSecurely(req)
  return `${secure ? 'wss' : 'ws'}://${host}/relay`
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[api] Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

app.get('/api/health', async (_req, res) => {
  res.json({
    ok:     true,
    agents: [...agents.values()].map((a) => ({ deviceId: a.deviceId, hostname: a.hostname })),
    jobs:   (await jobsDb.list()).length,
  })
})

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  await initDb()
  console.log('[api] Database ready')
  await recoverInterruptedJobs()

  setInterval(() => { void checkScheduledJobs() }, schedulerPollMs()).unref()
  void queueStartupJobs()

  server.listen(PORT, () => {
    console.log(`[api] Server running on http://localhost:${PORT}`)
    console.log(`[api] Agent WS:   ws://localhost:${PORT}/agent`)
    console.log(`[api] Browser WS: ws://localhost:${PORT}/`)
  })
}

main().catch((err) => { console.error('[api] Fatal:', err); process.exit(1) })
