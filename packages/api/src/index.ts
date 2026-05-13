import express from 'express'
import cors from 'cors'
import http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import cron from 'node-cron'
import { jobsDb, logDb } from './db'
import { createJobsRouter } from './routes/jobs'
import { notifyJob } from './notifications'
import type {
  AgentToServer,
  ServerToAgent,
  ServerToBrowser,
  Job,
} from '@sync-tool/shared'

const PORT = parseInt(process.env.PORT ?? '3001')

// ── Express app ───────────────────────────────────────────────────────────────

const app = express()
app.use(cors())
app.use(express.json())

// ── WebSocket servers ─────────────────────────────────────────────────────────

const server = http.createServer(app)

// Two WS namespaces on one HTTP server, distinguished by path
const agentWss   = new WebSocketServer({ noServer: true })   // /agent
const browserWss = new WebSocketServer({ noServer: true })   // /

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/agent') {
    agentWss.handleUpgrade(req, socket, head, (ws) => agentWss.emit('connection', ws, req))
  } else {
    browserWss.handleUpgrade(req, socket, head, (ws) => browserWss.emit('connection', ws, req))
  }
})

// ── Connected agent registry ──────────────────────────────────────────────────

interface AgentConn {
  ws:        WebSocket
  deviceId:  string
  hostname:  string
  platform:  string
}

const agents = new Map<string, AgentConn>()  // deviceId → connection

function sendToAgent(deviceId: string, msg: ServerToAgent): boolean {
  const conn = agents.get(deviceId)
  if (!conn || conn.ws.readyState !== WebSocket.OPEN) return false
  conn.ws.send(JSON.stringify(msg))
  return true
}

function broadcastJobRun(job: Job) {
  const targetedDeviceId = initiatingDeviceId(job)
  if (targetedDeviceId) {
    if (!sendToAgent(targetedDeviceId, { type: 'job:run', job } satisfies ServerToAgent)) {
      console.warn(`[api] Target agent ${targetedDeviceId} offline — job ${job.id} queued but not dispatched`)
    }
    return
  }

  for (const [, conn] of agents) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify({ type: 'job:run', job } satisfies ServerToAgent))
      return
    }
  }
  console.warn(`[api] No agents online — job ${job.id} queued but not dispatched`)
}

function queueJob(job: Job, reason: 'manual' | 'schedule' | 'watch'): boolean {
  if (job.status === 'running' || job.status === 'queued') return false
  jobsDb.setStatus(job.id, 'queued')
  const queued = { ...job, status: 'queued' as const }
  broadcastJobRun(queued)
  broadcastToBrowsers({ type: 'job:status', jobId: job.id, status: 'queued' })
  console.log(`[api] Job ${job.id} queued by ${reason}`)
  return true
}

function initiatingDeviceId(job: Job): string | undefined {
  if (!job.sourceDeviceId || !job.destinationDeviceId) return undefined
  if (job.direction === 'rtl') return job.destinationDeviceId
  return job.sourceDeviceId
}

function broadcastJobCancel(jobId: string) {
  for (const [, conn] of agents) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify({ type: 'job:cancel', jobId } satisfies ServerToAgent))
    }
  }
}

function sendWatchConfig(conn: AgentConn): void {
  if (conn.ws.readyState !== WebSocket.OPEN) return
  conn.ws.send(JSON.stringify({
    type: 'jobs:watch',
    jobs: jobsDb.list().filter((job) => job.watch),
  } satisfies ServerToAgent))
}

function broadcastWatchConfig(): void {
  for (const [, conn] of agents) sendWatchConfig(conn)
}

// ── Browser broadcast ─────────────────────────────────────────────────────────

function broadcastToBrowsers(msg: ServerToBrowser) {
  const payload = JSON.stringify(msg)
  for (const ws of browserWss.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload)
  }
}

// ── Agent WebSocket handler ───────────────────────────────────────────────────

agentWss.on('connection', (ws) => {
  let deviceId = ''

  ws.on('message', (raw) => {
    let msg: AgentToServer
    try { msg = JSON.parse(raw.toString()) } catch { return }

    switch (msg.type) {
      case 'register': {
        deviceId = msg.deviceId
        agents.set(deviceId, { ws, deviceId, hostname: msg.hostname, platform: msg.platform })
	        ws.send(JSON.stringify({ type: 'registered', ok: true } satisfies ServerToAgent))
	        broadcastToBrowsers({ type: 'agent:online', deviceId, hostname: msg.hostname })
	        console.log(`[api] Agent registered: ${msg.hostname} (${deviceId})`)
	        sendWatchConfig(agents.get(deviceId)!)

	        // Dispatch any queued jobs immediately
        const queued = jobsDb.list().filter((j) => j.status === 'queued')
        for (const job of queued) {
          ws.send(JSON.stringify({ type: 'job:run', job } satisfies ServerToAgent))
        }
        break
      }

	      case 'job:progress': {
	        broadcastToBrowsers({ type: 'job:progress', progress: msg.progress })
	        break
	      }

	      case 'job:trigger': {
	        const job = jobsDb.get(msg.jobId)
	        if (!job || !job.watch) break
	        queueJob(job, msg.reason)
	        break
	      }

      case 'job:started': {
        jobsDb.setStatus(msg.jobId, 'running')
        broadcastToBrowsers({ type: 'job:status', jobId: msg.jobId, status: 'running' })
        break
      }

      case 'job:complete': {
        const { result } = msg
        const job = jobsDb.get(result.jobId)
        jobsDb.setStatus(result.jobId, 'completed')
        logDb.complete(logDb.create(result.jobId), result)  // TODO: pass existing logId
        broadcastToBrowsers({ type: 'job:complete', result })
        void notifyJob(job, { status: 'completed', result })
        console.log(`[api] Job ${result.jobId} completed — ${result.filesCopied} files copied`)
        break
      }

      case 'job:cancelled': {
        const job = jobsDb.get(msg.jobId)
        jobsDb.setStatus(msg.jobId, 'cancelled')
        broadcastToBrowsers({ type: 'job:cancelled', jobId: msg.jobId })
        void notifyJob(job, { status: 'cancelled', jobId: msg.jobId })
        console.log(`[api] Job ${msg.jobId} cancelled`)
        break
      }

      case 'job:error': {
        const job = jobsDb.get(msg.jobId)
        jobsDb.setStatus(msg.jobId, 'error', msg.error)
        broadcastToBrowsers({ type: 'job:error', jobId: msg.jobId, error: msg.error })
        void notifyJob(job, { status: 'error', jobId: msg.jobId, error: msg.error })
        console.error(`[api] Job ${msg.jobId} failed: ${msg.error}`)
        break
      }
    }
  })

  ws.on('close', () => {
    if (deviceId) {
      agents.delete(deviceId)
      broadcastToBrowsers({ type: 'agent:offline', deviceId })
      console.log(`[api] Agent disconnected: ${deviceId}`)
    }
  })
})

// ── Browser WebSocket handler ─────────────────────────────────────────────────

browserWss.on('connection', (ws) => {
  // Send current agent states to new browser connection
  for (const [, conn] of agents) {
    ws.send(JSON.stringify({
      type: 'agent:online',
      deviceId: conn.deviceId,
      hostname: conn.hostname,
    } satisfies ServerToBrowser))
  }
})

// ── Cron scheduler ────────────────────────────────────────────────────────────

// Check every minute if any scheduled job needs to run
cron.schedule('* * * * *', () => {
  const now = new Date()
  for (const job of jobsDb.list()) {
    if (!job.schedule || job.status === 'running' || job.status === 'queued') continue
	    if (cron.validate(job.schedule) && shouldRunNow(job.schedule, now)) {
	      queueJob(job, 'schedule')
	    }
  }
})

// Minimal cron match — checks if a cron expression fires at the given minute
// For production, replace with a real cron parser (e.g. croner)
function shouldRunNow(expression: string, now: Date): boolean {
  try {
    // node-cron matches the current minute internally; we just call validate here
    // Real implementation: parse expression and check against now
    // TODO: use 'croner' or 'cron-parser' for accurate matching
    return false // placeholder — trigger manually via POST /api/jobs/:id/run for now
  } catch {
    return false
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/api/jobs', createJobsRouter((msg) => {
  if (msg.type === 'job:run') queueJob(msg.job, 'manual')
  if (msg.type === 'job:cancel') {
    broadcastJobCancel(msg.jobId)
    broadcastToBrowsers({ type: 'job:cancelled', jobId: msg.jobId })
  }
}, broadcastWatchConfig))

app.get('/api/health', (_req, res) => {
  res.json({
    ok:     true,
    agents: [...agents.values()].map((a) => ({ deviceId: a.deviceId, hostname: a.hostname })),
    jobs:   jobsDb.list().length,
  })
})

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[api] Server running on http://localhost:${PORT}`)
  console.log(`[api] Agent WS:   ws://localhost:${PORT}/agent`)
  console.log(`[api] Browser WS: ws://localhost:${PORT}/`)
})
