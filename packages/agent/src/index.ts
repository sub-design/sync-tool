import os from 'os'
import { WebSocket } from 'ws'
import { v4 as uuid } from 'uuid'
import pLimit from 'p-limit'
import { runSync } from './sync'
import { resolveBackend } from './backends/resolve'
import { RelayClient } from './relayClient'
import { canRunRemoteDelta, isRemoteDeltaJob, registerRemoteDeltaHandlers, runRemoteDeltaSync } from './delta/remote'
import { stateDb } from './state'
import { JobWatcher } from './watch'
import type { AgentToServer, ServerToAgent, Job } from '@sync-tool/shared'

// ── Config ────────────────────────────────────────────────────────────────────

const API_WS_BASE = process.env.API_URL  ?? 'ws://localhost:3001/agent'
const AGENT_TOKEN = process.env.AGENT_TOKEN  // required in production
const DEVICE_ID   = process.env.DEVICE_ID ?? uuid()   // persist this in production
const RELAY_URL   = process.env.RELAY_URL
const RECONNECT_MS = 5_000
const DEFAULT_CONCURRENCY = Math.max(1, parseInt(process.env.AGENT_CONCURRENCY ?? '2', 10))

// Append auth token to WS URL
const API_WS_URL = AGENT_TOKEN
  ? `${API_WS_BASE}${API_WS_BASE.includes('?') ? '&' : '?'}token=${encodeURIComponent(AGENT_TOKEN)}`
  : API_WS_BASE

if (!AGENT_TOKEN) {
  console.warn('[agent] AGENT_TOKEN not set — connection will be rejected by authenticated servers')
}

console.log(`[agent] Device ID : ${DEVICE_ID}`)
console.log(`[agent] Hostname  : ${os.hostname()}`)
console.log(`[agent] Connecting: ${API_WS_BASE}`)
if (RELAY_URL) console.log(`[agent] Relay URL : ${RELAY_URL}`)

const relay = RELAY_URL ? new RelayClient(RELAY_URL, DEVICE_ID) : undefined
if (relay) {
  registerRemoteDeltaHandlers(relay)
  relay.start()
}

// ── Running job queue ─────────────────────────────────────────────────────────

const jobLimit = pLimit(DEFAULT_CONCURRENCY)
const runningJobs = new Map<string, AbortController>()
const queuedJobs = new Set<string>()
let activeWs: WebSocket | undefined

const watcher = new JobWatcher(DEVICE_ID, (jobId, changedPath) => {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return
  console.log(`[watch] Change detected for job ${jobId}${changedPath ? `: ${changedPath}` : ''}`)
  send(activeWs, { type: 'job:trigger', jobId, reason: 'watch', path: changedPath })
})

// ── WebSocket connection ──────────────────────────────────────────────────────

function connect() {
  const ws = new WebSocket(API_WS_URL)

  ws.on('open', () => {
    activeWs = ws
    console.log('[agent] Connected to API server')
    send(ws, {
      type:     'register',
      deviceId: DEVICE_ID,
      hostname: os.hostname(),
      platform: process.platform,
    })
  })

  ws.on('message', async (raw) => {
    let msg: ServerToAgent
    try { msg = JSON.parse(raw.toString()) } catch { return }

    switch (msg.type) {
      case 'registered':
        console.log('[agent] Registered ✓')
        break

      case 'jobs:watch':
        watcher.sync(msg.jobs)
        break

      case 'job:run':
        await handleJobRun(ws, msg.job)
        break

      case 'job:cancel':
        if (queuedJobs.has(msg.jobId)) {
          queuedJobs.delete(msg.jobId)
          console.log(`[agent] Cancelled queued job ${msg.jobId}`)
          send(ws, { type: 'job:cancelled', jobId: msg.jobId })
        } else if (runningJobs.has(msg.jobId)) {
          console.log(`[agent] Cancel requested for ${msg.jobId}`)
          runningJobs.get(msg.jobId)?.abort()
        }
        break
    }
  })

  ws.on('close', () => {
    if (activeWs === ws) activeWs = undefined
    console.log(`[agent] Disconnected. Reconnecting in ${RECONNECT_MS / 1000}s...`)
    setTimeout(connect, RECONNECT_MS)
  })

  ws.on('error', (err) => {
    console.error('[agent] WS error:', err.message)
  })
}

// ── Job execution ─────────────────────────────────────────────────────────────

async function handleJobRun(ws: WebSocket, job: Job) {
  if (runningJobs.has(job.id) || queuedJobs.has(job.id)) {
    console.warn(`[agent] Job ${job.id} is already queued or running`)
    return
  }

  queuedJobs.add(job.id)
  void jobLimit(() => executeJob(ws, job))
}

async function executeJob(ws: WebSocket, job: Job) {
  if (!queuedJobs.has(job.id)) return
  queuedJobs.delete(job.id)

  const controller = new AbortController()
  runningJobs.set(job.id, controller)
  console.log(`[agent] Starting job "${job.name}" (${job.id})`)
  console.log(`[agent]   ${job.source} → ${job.destination} [${job.direction}]`)
  send(ws, { type: 'job:started', jobId: job.id })

  try {
    const onProgress = (progress: any) => {
        send(ws, { type: 'job:progress', progress: { ...progress, jobId: job.id } as any })

        if (progress.filesProcessed && progress.filesTotal) {
          const pct = Math.round((progress.filesProcessed / progress.filesTotal) * 100)
          process.stdout.write(`\r[agent] Progress: ${pct}% (${progress.currentFile})`)
        }
      }

    const result = await runJob(job, onProgress, controller.signal)

    process.stdout.write('\n')
    console.log(`[agent] Job complete: ${result.filesCopied} copied, ${result.filesSkipped} skipped, ${result.filesErrored} errors`)

    send(ws, { type: 'job:complete', result })
  } catch (err: any) {
    if (controller.signal.aborted) {
      console.log(`[agent] Job ${job.id} cancelled`)
      send(ws, { type: 'job:cancelled', jobId: job.id })
      return
    }

    console.error(`[agent] Job ${job.id} failed:`, err.message)
    send(ws, { type: 'job:error', jobId: job.id, error: err.message })
  } finally {
    runningJobs.delete(job.id)
  }
}

async function runJob(job: Job, onProgress: (progress: any) => void, signal: AbortSignal) {
  if (canRunRemoteDelta(job, DEVICE_ID, relay)) {
    return runRemoteDeltaSync(job, relay!, stateDb, onProgress, signal)
  }

  if (isRemoteDeltaJob(job)) {
    throw new Error('Remote delta job requires connected relay and matching source/destination device ids')
  }

  return runLocalSync(job, onProgress, signal)
}

async function runLocalSync(job: Job, onProgress: (progress: any) => void, signal: AbortSignal) {
  const source = resolveBackend(job.source)
  const destination = resolveBackend(job.destination)

  return runSync(
    job,
    source.backend,
    destination.backend,
    source.rootPath,
    destination.rootPath,
    stateDb,
    onProgress,
    signal,
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function send(ws: WebSocket, msg: AgentToServer) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

connect()
