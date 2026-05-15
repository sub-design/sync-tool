import WebSocket from 'ws'
import { getConfig } from './config'
import type { ServerToBrowser, Job, JobStatus } from '@sync-tool/shared'

export interface JobState {
  id:       string
  name:     string
  status:   JobStatus
  lastRun?: number
}

export type WsConnectionState = 'disconnected' | 'connecting' | 'connected'

const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

function backoffDelay(attempt: number): number {
  const delay = RECONNECT_BASE_MS * 2 ** Math.min(attempt, 10)
  const capped = Math.min(delay, RECONNECT_MAX_MS)
  return Math.round(capped * (0.75 + Math.random() * 0.5))
}

let ws: WebSocket | null = null
let reconnectTimer: NodeJS.Timeout | null = null
let reconnectAttempt = 0

let _connectionState: WsConnectionState = 'disconnected'
let _jobs: Map<string, JobState> = new Map()

type Listener = () => void
const listeners = new Set<Listener>()

export function onStateChange(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function notify() {
  for (const cb of listeners) cb()
}

export type JobNotificationEvent =
  | { kind: 'complete'; jobId: string; jobName: string; result: import('@sync-tool/shared').SyncResult }
  | { kind: 'error';    jobId: string; jobName: string; error: string }

type NotificationListener = (event: JobNotificationEvent) => void
const notificationListeners = new Set<NotificationListener>()

export function onJobNotification(cb: NotificationListener): () => void {
  notificationListeners.add(cb)
  return () => notificationListeners.delete(cb)
}

function emitNotification(event: JobNotificationEvent) {
  for (const cb of notificationListeners) cb(event)
}

export function connectionState(): WsConnectionState {
  return _connectionState
}

export function jobs(): JobState[] {
  return [..._jobs.values()]
}

function setConnectionState(s: WsConnectionState) {
  _connectionState = s
  notify()
}

export function connect(): void {
  const cfg = getConfig()
  if (!cfg.agentToken || !cfg.wsUrl) return

  if (ws) {
    ws.removeAllListeners()
    ws.close()
  }
  if (reconnectTimer) clearTimeout(reconnectTimer)

  setConnectionState('connecting')

  const url = `${cfg.wsUrl}?token=${encodeURIComponent(cfg.agentToken)}`
  ws = new WebSocket(url)

  ws.on('open', () => {
    reconnectAttempt = 0
    setConnectionState('connected')
    // Load initial job list via REST
    fetchJobs().catch(() => {})
  })

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as ServerToBrowser
      handleMessage(msg)
    } catch { /* ignore */ }
  })

  ws.on('close', () => {
    setConnectionState('disconnected')
    scheduleReconnect()
  })

  ws.on('error', () => {
    setConnectionState('disconnected')
    ws?.close()
  })
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  const delay = backoffDelay(reconnectAttempt++)
  reconnectTimer = setTimeout(connect, delay)
}

function handleMessage(msg: ServerToBrowser) {
  switch (msg.type) {
    case 'job:status': {
      const job = _jobs.get(msg.jobId)
      if (job) { job.status = msg.status; notify() }
      break
    }
    case 'job:complete': {
      const job = _jobs.get(msg.result.jobId)
      if (job) {
        job.status = 'completed'
        job.lastRun = msg.result.endedAt
        notify()
        emitNotification({ kind: 'complete', jobId: job.id, jobName: job.name, result: msg.result })
      }
      break
    }
    case 'job:error': {
      const job = _jobs.get(msg.jobId)
      if (job) {
        job.status = 'error'
        notify()
        emitNotification({ kind: 'error', jobId: job.id, jobName: job.name, error: msg.error })
      }
      break
    }
    case 'job:cancelled': {
      const job = _jobs.get(msg.jobId)
      if (job) { job.status = 'cancelled'; notify() }
      break
    }
  }
}

async function fetchJobs(): Promise<void> {
  const cfg = getConfig()
  const res = await fetch(`${cfg.apiUrl}/api/jobs`, {
    headers: { Authorization: `Bearer ${cfg.agentToken}` },
  })
  if (!res.ok) return
  const list: Job[] = await res.json()
  _jobs = new Map(list.map((j) => [j.id, { id: j.id, name: j.name, status: j.status, lastRun: j.lastRun }]))
  notify()
}

export function disconnect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  ws?.removeAllListeners()
  ws?.close()
  ws = null
  setConnectionState('disconnected')
}
