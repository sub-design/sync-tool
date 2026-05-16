import os from 'os'
import { WebSocket } from 'ws'
import type { AgentToRelay, RelayToAgent } from '@sync-tool/shared'
import { P2pManager } from './p2pManager'
import type { LanDiscovery } from './lanDiscovery'
import type { PeerServer } from './peerServer'

const REQUEST_TIMEOUT_MS = 120_000
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024

const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

function backoffDelay(attempt: number): number {
  const delay = RECONNECT_BASE_MS * 2 ** Math.min(attempt, 10)
  const capped = Math.min(delay, RECONNECT_MAX_MS)
  return Math.round(capped * (0.75 + Math.random() * 0.5))
}

export interface RelayEnvelope {
  id: string
  kind: 'request' | 'response' | 'event'
  method?: string
  ok?: boolean
  body?: any
  error?: string
}

export type TransportMode = 'direct' | 'p2p' | 'relay'

type RequestHandler = (from: string, method: string, body: any) => Promise<any>

export class RelayClient {
  private ws?: WebSocket
  private pending = new Map<string, { resolve: (value: any) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>()
  private handler?: RequestHandler
  private connected = false
  private fatalError = false
  private reconnectAttempt = 0
  private readonly p2p: P2pManager

  // LAN direct transport
  private lan?: LanDiscovery
  private ps?: PeerServer
  private lanOutgoing = new Map<string, WebSocket>()   // outgoing WS to peer servers
  private lastTransport = new Map<string, TransportMode>()

  constructor(
    private readonly relayUrl: string,
    private readonly deviceId: string,
    private readonly token?: string,
  ) {
    this.p2p = new P2pManager(deviceId, (to, signal) => {
      this.sendRaw({ type: 'relay:signal', to, signal })
    })
    this.p2p.onData((from, payload) => void this.handleData(from, payload))
  }

  start() {
    this.connect()
  }

  isReady(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN
  }

  onRequest(handler: RequestHandler) {
    this.handler = handler
  }

  getRequestHandler(): RequestHandler | undefined {
    return this.handler
  }

  getTransportMode(deviceId: string): TransportMode {
    return this.lastTransport.get(deviceId) ?? 'relay'
  }

  setLanDiscovery(lan: LanDiscovery, ps: PeerServer) {
    this.lan = lan
    this.ps = ps
    lan.onPeer((deviceId, peer) => {
      // Proactively open direct connection so it's ready before first sync
      this.openLanConnection(deviceId, peer.host, peer.port)
    })
  }

  async request(to: string, method: string, body: any): Promise<any> {
    if (!this.canReach(to)) throw new Error('No transport available to reach peer')

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const envelope: RelayEnvelope = { id, kind: 'request', method, body }

    const promise = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Relay request timed out: ${method}`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
    })

    this.send(to, envelope)
    return promise
  }

  async event(to: string, method: string, body: any): Promise<void> {
    if (!this.canReach(to)) throw new Error('No transport available to reach peer')
    this.send(to, {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      kind: 'event',
      method,
      body,
    })
    await this.waitForBackpressure()
  }

  private canReach(to: string): boolean {
    if (this.isReady()) return true
    if (this.getLanSocket(to)) return true
    if (this.p2p.isReady(to)) return true
    return false
  }

  private connect() {
    this.ws = new WebSocket(this.relayUrl)

    this.ws.on('open', () => {
      this.sendRaw({
        type:     'relay:register',
        deviceId: this.deviceId,
        name:     os.hostname(),
        hostname: os.hostname(),
        platform: process.platform,
        ...(this.token ? { token: this.token } : {}),
      })
      console.log(`[agent] Relay connected: ${this.relayUrl}`)
    })

    this.ws.on('message', (raw) => {
      let msg: RelayToAgent
      try { msg = JSON.parse(raw.toString()) } catch { return }

      if (msg.type === 'relay:registered') {
        this.connected = true
        this.reconnectAttempt = 0
        console.log('[agent] Relay registered ✓')
        return
      }

      if (msg.type === 'relay:error') {
        console.error(`[agent] Relay rejected connection: ${msg.message}`)
        this.fatalError = true
        this.ws?.close()
        return
      }

      if (msg.type === 'relay:peer:online') {
        this.p2p.onPeerOnline(msg.deviceId)
        return
      }

      if (msg.type === 'relay:peer:offline') {
        this.p2p.onPeerOffline(msg.deviceId)
        return
      }

      if (msg.type === 'relay:signal') {
        this.p2p.onSignal(msg.from, msg.signal)
        return
      }

      if (msg.type !== 'relay:data') return
      void this.handleData(msg.from, msg.payload)
    })

    this.ws.on('close', () => {
      this.connected = false
      if (this.fatalError) {
        this.p2p.closeAll()
        console.error('[agent] Relay connection permanently closed due to error.')
        return
      }
      const delay = backoffDelay(this.reconnectAttempt++)
      console.log(`[agent] Relay disconnected. Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})...`)
      setTimeout(() => this.connect(), delay)
    })

    this.ws.on('error', (err) => {
      console.error('[agent] Relay error:', err.message)
    })
  }

  private async handleData(from: string, payload: string) {
    let envelope: RelayEnvelope
    try {
      envelope = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
    } catch {
      return
    }

    if (envelope.kind === 'response') {
      const pending = this.pending.get(envelope.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(envelope.id)
      envelope.ok ? pending.resolve(envelope.body) : pending.reject(new Error(envelope.error ?? 'Relay request failed'))
      return
    }

    if (envelope.kind === 'request' && envelope.method && this.handler) {
      try {
        const body = await this.handler(from, envelope.method, envelope.body)
        this.send(from, { id: envelope.id, kind: 'response', ok: true, body })
      } catch (err: any) {
        this.send(from, { id: envelope.id, kind: 'response', ok: false, error: err.message })
      }
    }

    if (envelope.kind === 'event' && envelope.method && this.handler) {
      try {
        await this.handler(from, envelope.method, envelope.body)
      } catch (err: any) {
        console.error(`[agent] Relay event ${envelope.method} failed:`, err.message)
      }
    }
  }

  private send(to: string, envelope: RelayEnvelope) {
    const payload = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64')

    // Priority 1: incoming LAN connection (peer connected to our PeerServer)
    const incomingLan = this.ps?.getSocket(to)
    if (incomingLan) {
      incomingLan.send(payload)
      this.lastTransport.set(to, 'direct')
      return
    }

    // Priority 2: outgoing LAN connection (we connected to their PeerServer)
    const outgoingLan = this.getLanOutgoing(to)
    if (outgoingLan) {
      outgoingLan.send(payload)
      this.lastTransport.set(to, 'direct')
      return
    }

    // Priority 3: WebRTC P2P
    if (this.p2p.send(to, payload)) {
      this.lastTransport.set(to, 'p2p')
      return
    }

    // Priority 4: relay fallback
    this.lastTransport.set(to, 'relay')
    this.sendRaw({ type: 'relay:data', to, payload })
  }

  private getLanSocket(to: string): WebSocket | undefined {
    return this.ps?.getSocket(to) ?? this.getLanOutgoing(to)
  }

  private getLanOutgoing(to: string): WebSocket | undefined {
    const ws = this.lanOutgoing.get(to)
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      if (ws) this.lanOutgoing.delete(to)
      return undefined
    }
    return ws
  }

  private openLanConnection(deviceId: string, host: string, port: number) {
    if (this.lanOutgoing.has(deviceId)) return
    const url = `ws://${host}:${port}/?deviceId=${encodeURIComponent(this.deviceId)}&token=${encodeURIComponent(this.token ?? '')}`
    const ws  = new WebSocket(url)

    ws.on('open', () => {
      this.lanOutgoing.set(deviceId, ws)
      console.log(`[lan] Direct connection to ${deviceId.slice(0, 8)} established`)
    })

    ws.on('message', (raw) => void this.handleData(deviceId, raw.toString()))

    ws.on('close', () => {
      if (this.lanOutgoing.get(deviceId) === ws) this.lanOutgoing.delete(deviceId)
    })

    ws.on('error', (err) => {
      console.error(`[lan] Direct connection to ${deviceId.slice(0, 8)} error:`, err.message)
      if (this.lanOutgoing.get(deviceId) === ws) this.lanOutgoing.delete(deviceId)
    })
  }

  private sendRaw(msg: AgentToRelay) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  private async waitForBackpressure(): Promise<void> {
    while (this.ws && this.ws.readyState === WebSocket.OPEN && this.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}
