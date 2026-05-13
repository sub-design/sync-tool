import express from 'express'
import cors from 'cors'
import http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { initDb, jobsDb, logDb } from './db'
import { createJobsRouter } from './routes/jobs'
import { createAuthRouter } from './routes/auth'
import { createDevicesRouter } from './routes/devices'
import { authFromWsRequest } from './middleware/requireAuth'
import { notifyJob } from './notifications'
import { schedulerPollMs, shouldRunNow } from './scheduler'
import type { AgentToServer, ServerToAgent, ServerToBrowser, Job } from '@sync-tool/shared'

const PORT = parseInt(process.env.PORT ?? '3001', 10)

// ── Express app ───────────────────────────────────────────────────────────────

const app = express()
app.use(cors())
app.use(express.json())

// ── WebSocket servers ─────────────────────────────────────────────────────────

const server = http.createServer(app)
const agentWss   = new WebSocketServer({ noServer: true })
const browserWss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  authFromWsRequest(req).then((userId) => {
    if (!userId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    if (req.url?.startsWith('/agent')) {
      agentWss.handleUpgrade(req, socket, head, (ws) => agentWss.emit('connection', ws, req, userId))
    } else {
      browserWss.handleUpgrade(req, socket, head, (ws) => browserWss.emit('connection', ws, req, userId))
    }
  }).catch(() => {
    socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
    socket.destroy()
  })
})

// ── Agent registry ────────────────────────────────────────────────────────────

interface AgentConn {
  ws: WebSocket; userId: string; deviceId: string; hostname: string; platform: string
}

const agents = new Map<string, AgentConn>()

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

async function broadcastJobRun(job: Job) {
  const target = initiatingDeviceId(job)
  if (target) {
    if (!sendToAgent(target, { type: 'job:run', job }))
      console.warn(`[api] Target agent ${target} offline — job ${job.id} not dispatched`)
    return
  }
  for (const [, conn] of agents) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify({ type: 'job:run', job } satisfies ServerToAgent))
      return
    }
  }
  console.warn(`[api] No agents online — job ${job.id} not dispatched`)
}

async function queueJob(job: Job, reason: 'manual' | 'schedule' | 'watch'): Promise<boolean> {
  if (job.status === 'running' || job.status === 'queued') return false
  await jobsDb.setStatus(job.id, 'queued')
  const queued = { ...job, status: 'queued' as const }
  await broadcastJobRun(queued)
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
  const jobs = (await jobsDb.listForUser(conn.userId)).filter((j) => j.watch)
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

agentWss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, userId: string) => {
  let deviceId = ''

  ws.on('message', async (raw) => {
    let msg: AgentToServer
    try { msg = JSON.parse(raw.toString()) } catch { return }

    switch (msg.type) {
      case 'register': {
        deviceId = msg.deviceId
        agents.set(deviceId, { ws, userId, deviceId, hostname: msg.hostname, platform: msg.platform })
        ws.send(JSON.stringify({ type: 'registered', ok: true } satisfies ServerToAgent))
        broadcastToBrowsers({ type: 'agent:online', deviceId, hostname: msg.hostname }, userId)
        console.log(`[api] Agent registered: ${msg.hostname} (${deviceId})`)
        await sendWatchConfig(agents.get(deviceId)!)
        const queued = (await jobsDb.listForUser(userId)).filter((j) => j.status === 'queued')
        for (const job of queued) ws.send(JSON.stringify({ type: 'job:run', job } satisfies ServerToAgent))
        break
      }
      case 'job:progress': {
        const job = await jobsDb.get(msg.progress.jobId)
        const jUid = job ? await jobsDb.getUserId(job.id) : undefined
        broadcastToBrowsers({ type: 'job:progress', progress: msg.progress }, jUid)
        break
      }
      case 'job:trigger': {
        const job = await jobsDb.get(msg.jobId)
        if (job?.watch) await queueJob(job, msg.reason)
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
        await jobsDb.setStatus(result.jobId, 'completed')
        await logDb.complete(await logDb.create(result.jobId), result)
        broadcastToBrowsers({ type: 'job:complete', result }, jUid)
        void notifyJob(job, { status: 'completed', result })
        console.log(`[api] Job ${result.jobId} completed — ${result.filesCopied} files`)
        break
      }
      case 'job:cancelled': {
        const job  = await jobsDb.get(msg.jobId)
        const jUid = await jobsDb.getUserId(msg.jobId)
        await jobsDb.setStatus(msg.jobId, 'cancelled')
        broadcastToBrowsers({ type: 'job:cancelled', jobId: msg.jobId }, jUid)
        void notifyJob(job, { status: 'cancelled', jobId: msg.jobId })
        break
      }
      case 'job:error': {
        const job  = await jobsDb.get(msg.jobId)
        const jUid = await jobsDb.getUserId(msg.jobId)
        await jobsDb.setStatus(msg.jobId, 'error', msg.error)
        broadcastToBrowsers({ type: 'job:error', jobId: msg.jobId, error: msg.error }, jUid)
        void notifyJob(job, { status: 'error', jobId: msg.jobId, error: msg.error })
        console.error(`[api] Job ${msg.jobId} failed: ${msg.error}`)
        break
      }
    }
  })

  ws.on('close', () => {
    if (deviceId) {
      const conn = agents.get(deviceId)
      agents.delete(deviceId)
      broadcastToBrowsers({ type: 'agent:offline', deviceId }, conn?.userId)
      console.log(`[api] Agent disconnected: ${deviceId}`)
    }
  })
})

// ── Browser WebSocket ─────────────────────────────────────────────────────────

browserWss.on('connection', async (ws: WebSocket, _req: http.IncomingMessage, userId: string) => {
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
    if (!job.schedule || job.status === 'running' || job.status === 'queued') continue
    if (shouldRunNow(job.schedule, now, job.lastRun)) await queueJob(job, 'schedule')
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/api/auth',    createAuthRouter())
app.use('/api/devices', createDevicesRouter())
app.use('/api/jobs',    createJobsRouter(async (msg) => {
  if (msg.type === 'job:run')    await queueJob(msg.job, 'manual')
  if (msg.type === 'job:cancel') {
    broadcastJobCancel(msg.jobId)
    broadcastToBrowsers({ type: 'job:cancelled', jobId: msg.jobId })
  }
}, () => { void broadcastWatchConfig() }))

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

  setInterval(() => { void checkScheduledJobs() }, schedulerPollMs()).unref()

  server.listen(PORT, () => {
    console.log(`[api] Server running on http://localhost:${PORT}`)
    console.log(`[api] Agent WS:   ws://localhost:${PORT}/agent`)
    console.log(`[api] Browser WS: ws://localhost:${PORT}/`)
  })
}

main().catch((err) => { console.error('[api] Fatal:', err); process.exit(1) })
