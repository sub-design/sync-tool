import { create } from 'zustand'
import type { ServerToBrowser, SyncProgress } from '../types'
import { getToken } from './auth'

const WS_BASE = (import.meta.env.VITE_WS_URL as string | undefined) ?? 'ws://localhost:3001'

type Listener = (msg: ServerToBrowser) => void
const listeners = new Map<string, Set<Listener>>()

function notify(msg: ServerToBrowser) {
  listeners.get(msg.type)?.forEach(fn => fn(msg))
}

let ws: WebSocket | null = null

function connect() {
  const token = getToken()
  if (!token) return  // Don't connect if not logged in

  ws = new WebSocket(WS_BASE, [`auth.${base64Url(token)}`])

  ws.onmessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string) as ServerToBrowser
      notify(msg)
      handleStore(msg)
    } catch {
      // ignore malformed messages
    }
  }

  ws.onclose = () => {
    if (getToken()) setTimeout(connect, 3000)
  }
  ws.onerror = () => { ws?.close() }
}

function base64Url(value: string): string {
  return btoa(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

connect()

// Re-connect after login
export function reconnectWs(): void {
  ws?.close()
  connect()
}

export function subscribe<T extends ServerToBrowser['type']>(
  type: T,
  fn: (msg: Extract<ServerToBrowser, { type: T }>) => void,
): () => void {
  if (!listeners.has(type)) listeners.set(type, new Set())
  listeners.get(type)!.add(fn as Listener)
  return () => listeners.get(type)?.delete(fn as Listener)
}

interface WsStore {
  agentsOnline: Map<string, string>
  jobProgress: Map<string, SyncProgress>
}

export const useWsStore = create<WsStore>(() => ({
  agentsOnline: new Map(),
  jobProgress: new Map(),
}))

function handleStore(msg: ServerToBrowser) {
  if (msg.type === 'agent:online') {
    useWsStore.setState(s => {
      const m = new Map(s.agentsOnline)
      m.set(msg.deviceId, msg.hostname)
      return { agentsOnline: m }
    })
  } else if (msg.type === 'agent:offline') {
    useWsStore.setState(s => {
      const m = new Map(s.agentsOnline)
      m.delete(msg.deviceId)
      return { agentsOnline: m }
    })
  } else if (msg.type === 'job:progress') {
    useWsStore.setState(s => {
      const m = new Map(s.jobProgress)
      m.set(msg.progress.jobId, msg.progress)
      return { jobProgress: m }
    })
  }
}
