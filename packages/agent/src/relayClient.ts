import os from 'os'
import { WebSocket } from 'ws'
import type { AgentToRelay, RelayToAgent } from '@sync-tool/shared'

const REQUEST_TIMEOUT_MS = 120_000
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024

export interface RelayEnvelope {
  id: string
  kind: 'request' | 'response' | 'event'
  method?: string
  ok?: boolean
  body?: any
  error?: string
}

type RequestHandler = (from: string, method: string, body: any) => Promise<any>

export class RelayClient {
  private ws?: WebSocket
  private pending = new Map<string, { resolve: (value: any) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>()
  private handler?: RequestHandler
  private connected = false

  constructor(
    private readonly relayUrl: string,
    private readonly deviceId: string,
  ) {}

  start() {
    this.connect()
  }

  isReady(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN
  }

  onRequest(handler: RequestHandler) {
    this.handler = handler
  }

  async request(to: string, method: string, body: any): Promise<any> {
    if (!this.isReady()) throw new Error('Relay is not connected')

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
    if (!this.isReady()) throw new Error('Relay is not connected')
    this.send(to, {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      kind: 'event',
      method,
      body,
    })
    await this.waitForBackpressure()
  }

  private connect() {
    this.ws = new WebSocket(this.relayUrl)

    this.ws.on('open', () => {
      this.connected = true
      this.sendRaw({
        type:     'relay:register',
        deviceId: this.deviceId,
        name:     os.hostname(),
        hostname: os.hostname(),
        platform: process.platform,
      })
      console.log(`[agent] Relay connected: ${this.relayUrl}`)
    })

    this.ws.on('message', (raw) => {
      let msg: RelayToAgent
      try { msg = JSON.parse(raw.toString()) } catch { return }
      if (msg.type !== 'relay:data') return
      void this.handleData(msg.from, msg.payload)
    })

    this.ws.on('close', () => {
      this.connected = false
      console.log('[agent] Relay disconnected. Reconnecting in 5s...')
      setTimeout(() => this.connect(), 5_000)
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
    this.sendRaw({
      type:    'relay:data',
      to,
      payload: Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64'),
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
