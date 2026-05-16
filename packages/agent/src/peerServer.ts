import http from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import type { RelayEnvelope } from './relayClient'

type RequestHandler = (from: string, method: string, body: any) => Promise<any>

export class PeerServer {
  private wss?:    WebSocketServer
  private handler?: RequestHandler
  // Sockets keyed by deviceId for sending data back to connected peers
  private sockets = new Map<string, WebSocket>()

  constructor(
    private readonly port:  number,
    private readonly token: string | undefined,
  ) {}

  onRequest(handler: RequestHandler) {
    this.handler = handler
  }

  getSocket(deviceId: string): WebSocket | undefined {
    const ws = this.sockets.get(deviceId)
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.sockets.delete(deviceId)
      return undefined
    }
    return ws
  }

  start() {
    const server = http.createServer()
    this.wss = new WebSocketServer({ server })

    this.wss.on('connection', (ws, req) => {
      const url      = new URL(req.url ?? '/', 'http://localhost')
      const peerId   = url.searchParams.get('deviceId') ?? 'unknown'
      const peerToken = url.searchParams.get('token')

      if (this.token && peerToken !== this.token) {
        ws.close(4001, 'Unauthorized')
        return
      }

      this.sockets.set(peerId, ws)
      console.log(`[lan] Peer ${peerId.slice(0, 8)} connected directly from ${req.socket.remoteAddress}`)

      ws.on('message', (raw) => void this.handleMessage(ws, peerId, raw.toString()))

      ws.on('close', () => {
        if (this.sockets.get(peerId) === ws) this.sockets.delete(peerId)
        console.log(`[lan] Peer ${peerId.slice(0, 8)} disconnected`)
      })

      ws.on('error', (err) => {
        console.error(`[lan] Peer ${peerId.slice(0, 8)} error:`, err.message)
      })
    })

    server.listen(this.port, () => {
      console.log(`[lan] Peer server listening on TCP ${this.port}`)
    })
  }

  private async handleMessage(ws: WebSocket, from: string, raw: string) {
    let envelope: RelayEnvelope
    try {
      envelope = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
    } catch {
      return
    }

    if (envelope.kind === 'request' && envelope.method && this.handler) {
      try {
        const body     = await this.handler(from, envelope.method, envelope.body)
        const response: RelayEnvelope = { id: envelope.id, kind: 'response', ok: true, body }
        ws.send(Buffer.from(JSON.stringify(response), 'utf8').toString('base64'))
      } catch (err: any) {
        const response: RelayEnvelope = { id: envelope.id, kind: 'response', ok: false, error: err.message }
        ws.send(Buffer.from(JSON.stringify(response), 'utf8').toString('base64'))
      }
    }

    if (envelope.kind === 'event' && envelope.method && this.handler) {
      try {
        await this.handler(from, envelope.method, envelope.body)
      } catch (err: any) {
        console.error(`[lan] Event handler error (${envelope.method}):`, err.message)
      }
    }
  }
}
