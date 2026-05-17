import 'dotenv/config'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { WebSocket } from 'ws'
import { v4 as uuid } from 'uuid'
import pLimit from 'p-limit'
import { runSync, performRollback } from './sync'
import type { SyncFileEvent } from '@sync-tool/shared'
import { resolveBackend } from './backends/resolve'
import { assertAllowedLocalEndpoint, assertAllowedPath } from './fileGuard'
import { RelayClient } from './relayClient'
import { canRunRemoteDelta, isRemoteDeltaJob, registerRemoteDeltaHandlers, runRemoteDeltaSync } from './delta/remote'
import { stateDb } from './state'
import { JobWatcher } from './watch'
import { LanDiscovery, getLanScope } from './lanDiscovery'
import { PeerServer } from './peerServer'
import type { AgentToServer, ServerToAgent, Job, DirEntry } from '@sync-tool/shared'

// ── Config ────────────────────────────────────────────────────────────────────

const API_WS_BASE  = process.env.API_URL  ?? 'ws://localhost:3001/agent'
const AGENT_TOKEN  = process.env.AGENT_TOKEN  // required in production
const DEVICE_ID    = process.env.DEVICE_ID ?? uuid()   // persist this in production
const RELAY_URL    = process.env.RELAY_URL
const RELAY_TOKEN  = process.env.RELAY_TOKEN  // shared secret for relay auth
const RECONNECT_MS = 5_000
const DEFAULT_CONCURRENCY = Math.max(1, parseInt(process.env.AGENT_CONCURRENCY ?? '2', 10))
const LAN_ENABLED  = process.env.LAN_DISCOVERY_ENABLED !== 'false'  // on by default
const PEER_PORT    = parseInt(process.env.PEER_SERVER_PORT ?? '33339', 10)

if (!AGENT_TOKEN) {
  console.warn('[agent] AGENT_TOKEN not set — connection will be rejected by authenticated servers')
}

console.log(`[agent] Device ID : ${DEVICE_ID}`)
console.log(`[agent] Hostname  : ${os.hostname()}`)
console.log(`[agent] Connecting: ${API_WS_BASE}`)
if (RELAY_URL) console.log(`[agent] Relay URL : ${RELAY_URL}`)
if (RELAY_URL && !RELAY_TOKEN) console.warn('[agent] RELAY_TOKEN not set — relay will reject connection if RELAY_SECRET is configured')

const relay = RELAY_URL ? new RelayClient(RELAY_URL, DEVICE_ID, RELAY_TOKEN) : undefined
if (relay) {
  registerRemoteDeltaHandlers(relay)

  if (LAN_ENABLED) {
    const peerServer = new PeerServer(PEER_PORT, RELAY_TOKEN)
    // Route LAN peer requests through the same handler relay uses
    peerServer.onRequest((from, method, body) => {
      const handler = relay.getRequestHandler()
      if (!handler) throw new Error('No relay handler registered')
      return handler(from, method, body)
    })
    peerServer.start()

    const lanScope     = getLanScope(RELAY_TOKEN)
    const lanDiscovery = new LanDiscovery(DEVICE_ID, os.hostname(), lanScope, PEER_PORT)
    relay.setLanDiscovery(lanDiscovery, peerServer)
    lanDiscovery.start()
  }

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
  const ws = new WebSocket(API_WS_BASE, AGENT_TOKEN
    ? { headers: { Authorization: `Bearer ${AGENT_TOKEN}` } }
    : undefined)

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

      case 'browse:request':
        await handleBrowse(ws, msg.requestId, msg.path)
        break

      case 'job:rollback':
        void handleRollback(ws, msg.job, msg.logId, msg.manifest)
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

    const onFileDone = (file: SyncFileEvent) => {
      send(ws, { type: 'job:file:done', jobId: job.id, file })
    }

    const result = await runJob(job, onProgress, controller.signal, onFileDone)

    process.stdout.write('\n')
    console.log(`[agent] Job complete: ${result.filesCopied} copied, ${result.filesDeleted ?? 0} deleted, ${result.filesSkipped} skipped, ${result.filesErrored} errors`)

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

async function runJob(job: Job, onProgress: (progress: any) => void, signal: AbortSignal, onFileDone?: (file: SyncFileEvent) => void) {
  if (canRunRemoteDelta(job, DEVICE_ID, relay)) {
    return runRemoteDeltaSync(job, relay!, stateDb, onProgress, signal)
  }

  if (isRemoteDeltaJob(job)) {
    throw new Error('Remote delta job requires connected relay and matching source/destination device ids')
  }

  return runLocalSync(job, onProgress, signal, onFileDone)
}

async function runLocalSync(job: Job, onProgress: (progress: any) => void, signal: AbortSignal, onFileDone?: (file: SyncFileEvent) => void) {
  await Promise.all([
    assertAllowedLocalEndpoint(job.source),
    assertAllowedLocalEndpoint(job.destination),
  ])

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
    onFileDone,
  )
}

// ── Rollback ──────────────────────────────────────────────────────────────────

async function handleRollback(ws: WebSocket, job: Job, logId: string, manifest: import('@sync-tool/shared').RollbackManifest) {
  console.log(`[agent] Starting rollback for job "${job.name}", logId=${logId}`)
  try {
    const source      = resolveBackend(job.source)
    const destination = resolveBackend(job.destination)

    const result = await performRollback(
      manifest,
      source.backend,
      destination.backend,
      source.rootPath,
      destination.rootPath,
      (progress) => {
        send(ws, {
          type:          'job:rollback:progress',
          jobId:         job.id,
          filesRestored: progress.filesRestored,
          filesTotal:    progress.filesTotal,
          currentFile:   progress.currentFile,
        })
      },
    )

    send(ws, { type: 'job:rollback:complete', jobId: job.id, result })
  } catch (err: any) {
    console.error(`[agent] Rollback failed for logId=${logId}:`, err.message)
    send(ws, { type: 'job:rollback:error', jobId: job.id, error: err.message })
  }
}

// ── Directory browse ──────────────────────────────────────────────────────────

async function handleBrowse(ws: WebSocket, requestId: string, rawPath: string) {
  let resolved = rawPath

  try {
    const allowed = await assertAllowedPath(rawPath)
    resolved = allowed.resolvedPath
    const dirents = await fs.promises.readdir(resolved, { withFileTypes: true })
    const entries: DirEntry[] = await Promise.all(
      dirents.map(async (d) => {
        const full = path.join(resolved, d.name)
        let size: number | undefined
        let modifiedAt: number | undefined
        try {
          const stat = await fs.promises.stat(full)
          size       = stat.size
          modifiedAt = stat.mtimeMs
        } catch { /* ignore stat errors for individual entries */ }
        return {
          name: d.name,
          type: d.isDirectory() ? 'directory' : 'file',
          path: full,
          size,
          modifiedAt,
        } satisfies DirEntry
      })
    )
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    send(ws, { type: 'browse:result', requestId, path: resolved, entries })
  } catch (err: any) {
    send(ws, { type: 'browse:result', requestId, path: resolved, entries: [], error: err.message })
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function send(ws: WebSocket, msg: AgentToServer) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

connect()
