/**
 * Relay Server — Phase A (GoodSync Connect analog)
 *
 * Allows two agents behind NAT to communicate without port forwarding.
 * Both agents connect OUTBOUND to this server on a public IP.
 * The server routes messages between them by deviceId.
 *
 * Deploy this on any $5/mo VPS with a public IP (Hetzner, DigitalOcean, etc.)
 *
 * Usage:
 *   On agent: set RELAY_URL=wss://your-vps:3002
 *
 * Phase B TODO: add STUN hole-punch signaling so agents can go P2P
 * Phase C TODO: WireGuard mesh coordinator
 */

import http from 'http'
import crypto from 'crypto'
import { WebSocketServer, WebSocket } from 'ws'
import type { AgentToRelay, RelayToAgent, RelayDevice } from '@sync-tool/shared'

const PORT         = parseInt(process.env.PORT ?? '3002')
const RELAY_SECRET = process.env.RELAY_SECRET  // if set, agents must pass this token
const RELAY_TOKENS = parseRelayTokens(process.env.RELAY_TOKENS)

const server = http.createServer((req, res) => {
  if (secureTransportRequired() && !requestArrivedSecurely(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Secure transport required' }))
    return
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok:      true,
      devices: [...devices.values()].map((d) => ({
        deviceId: d.deviceId,
        name:     d.name,
        hostname: d.hostname,
        online:   d.online,
      })),
    }))
  } else {
    res.writeHead(404)
    res.end()
  }
})

const wss = new WebSocketServer({ server })

// ── Device registry ───────────────────────────────────────────────────────────

interface DeviceConn extends RelayDevice {
  ws: WebSocket
  scope: string
}

const devices = new Map<string, DeviceConn>()  // `${scope}\0${deviceId}` → connection

// ── Helpers ───────────────────────────────────────────────────────────────────

function deviceKey(scope: string, deviceId: string): string {
  return `${scope}\0${deviceId}`
}

function sendToDevice(scope: string, deviceId: string, msg: RelayToAgent): boolean {
  const dev = devices.get(deviceKey(scope, deviceId))
  if (!dev || dev.ws.readyState !== WebSocket.OPEN) return false
  dev.ws.send(JSON.stringify(msg))
  return true
}

function broadcastPeerEvent(scope: string, except: string, msg: RelayToAgent) {
  for (const dev of devices.values()) {
    if (dev.scope === scope && dev.deviceId !== except && dev.ws.readyState === WebSocket.OPEN) {
      dev.ws.send(JSON.stringify(msg))
    }
  }
}

// ── WebSocket handler ─────────────────────────────────────────────────────────

wss.on('connection', (ws, req) => {
  let deviceId = ''
  let scope = ''
  const remoteIp = req.socket.remoteAddress ?? 'unknown'

  if (secureTransportRequired() && !requestArrivedSecurely(req)) {
    ws.close(1008, 'Secure transport required')
    return
  }

  ws.on('message', (raw) => {
    let msg: AgentToRelay
    try { msg = JSON.parse(raw.toString()) } catch { return }

    switch (msg.type) {
      case 'relay:register': {
        const registration = validateRelayToken(msg.token)
        if (!registration) {
          ws.send(JSON.stringify({ type: 'relay:error', message: 'Unauthorized' } satisfies RelayToAgent))
          ws.close(1008, 'Unauthorized')
          console.warn(`[relay] Rejected unauthorized connection from ${remoteIp}`)
          return
        }

        deviceId = msg.deviceId
        scope = registration.scope

        const device: DeviceConn = {
          ws,
          scope,
          deviceId:  msg.deviceId,
          name:      msg.name,
          hostname:  msg.hostname,
          platform:  msg.platform,
          online:    true,
          lastSeen:  Date.now(),
        }
        devices.set(deviceKey(scope, deviceId), device)

        // Acknowledge registration
        ws.send(JSON.stringify({ type: 'relay:registered', ok: true } satisfies RelayToAgent))

        // Tell this device about all currently online peers
        for (const peer of devices.values()) {
          if (peer.scope === scope && peer.deviceId !== deviceId) {
            ws.send(JSON.stringify({
              type:     'relay:peer:online',
              deviceId: peer.deviceId,
              name:     peer.name,
            } satisfies RelayToAgent))
          }
        }

        // Tell all other devices this one came online
        broadcastPeerEvent(scope, deviceId, {
          type:     'relay:peer:online',
          deviceId: msg.deviceId,
          name:     msg.name,
        })

        console.log(`[relay] Registered: ${msg.name} (${msg.deviceId}) scope=${scope} from ${remoteIp}`)
        break
      }

      case 'relay:data': {
        if (!scope || !deviceId) {
          ws.close(1008, 'Not registered')
          return
        }
        // Route payload from sender → recipient
        // The payload is opaque (base64 binary data or JSON tunnel frames)
        const delivered = sendToDevice(scope, msg.to, {
          type:    'relay:data',
          from:    deviceId,
          payload: msg.payload,
        })

        if (!delivered) {
          console.warn(`[relay] Device ${msg.to} not found or offline, dropped message from ${deviceId}`)
        }
        break
      }

      case 'relay:signal': {
        if (!scope || !deviceId) {
          ws.close(1008, 'Not registered')
          return
        }
        // Route WebRTC signaling (SDP offer/answer + ICE candidates) for hole-punch
        const delivered = sendToDevice(scope, msg.to, {
          type:   'relay:signal',
          from:   deviceId,
          signal: msg.signal,
        })
        if (!delivered) {
          console.warn(`[relay] Signal target ${msg.to} offline, dropped from ${deviceId}`)
        }
        break
      }
    }
  })

  ws.on('close', () => {
    if (deviceId) {
      devices.delete(deviceKey(scope, deviceId))
      broadcastPeerEvent(scope, deviceId, {
        type:     'relay:peer:offline',
        deviceId: deviceId,
      })
      console.log(`[relay] Disconnected: ${deviceId}`)
    }
  })

  ws.on('error', (err) => {
    console.error(`[relay] Error (${deviceId}):`, err.message)
  })
})

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[relay] Relay server running on ws://0.0.0.0:${PORT}`)
  console.log(`[relay] Health: http://localhost:${PORT}/health`)
  console.log()
  console.log('  Deploy this on a VPS with a public IP.')
  console.log('  Point agents to it with:  RELAY_URL=wss://your-vps:3002')
})

interface TokenValidation {
  scope: string
}

function validateRelayToken(token: string | undefined): TokenValidation | null {
  if (RELAY_TOKENS.size > 0) {
    if (!token) return null
    return RELAY_TOKENS.get(token) ?? null
  }

  if (RELAY_SECRET) {
    return token === RELAY_SECRET ? { scope: 'legacy' } : null
  }

  return { scope: token ? tokenScope(token) : 'dev' }
}

function parseRelayTokens(raw: string | undefined): Map<string, TokenValidation> {
  const tokens = new Map<string, TokenValidation>()
  if (!raw) return tokens

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf(':')
    if (idx <= 0 || idx === trimmed.length - 1) {
      console.warn(`[relay] Ignoring malformed RELAY_TOKENS entry: ${trimmed}`)
      continue
    }
    const scope = trimmed.slice(0, idx)
    const token = trimmed.slice(idx + 1)
    tokens.set(token, { scope })
  }

  return tokens
}

function tokenScope(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)
}

function secureTransportRequired(): boolean {
  return process.env.REQUIRE_SECURE_TRANSPORT === 'true'
}

function requestArrivedSecurely(req: http.IncomingMessage): boolean {
  return isLocalAddress(req.socket.remoteAddress) || forwardedProto(req).some(isSecureProto)
}

function forwardedProto(req: http.IncomingMessage): string[] {
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
