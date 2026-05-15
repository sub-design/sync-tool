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
import { WebSocketServer, WebSocket } from 'ws'
import type { AgentToRelay, RelayToAgent, RelayDevice } from '@sync-tool/shared'

const PORT         = parseInt(process.env.PORT ?? '3002')
const RELAY_SECRET = process.env.RELAY_SECRET  // if set, agents must pass this token

const server = http.createServer((req, res) => {
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
}

const devices = new Map<string, DeviceConn>()  // deviceId → connection

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendToDevice(deviceId: string, msg: RelayToAgent): boolean {
  const dev = devices.get(deviceId)
  if (!dev || dev.ws.readyState !== WebSocket.OPEN) return false
  dev.ws.send(JSON.stringify(msg))
  return true
}

function broadcastPeerEvent(except: string, msg: RelayToAgent) {
  for (const [id, dev] of devices) {
    if (id !== except && dev.ws.readyState === WebSocket.OPEN) {
      dev.ws.send(JSON.stringify(msg))
    }
  }
}

// ── WebSocket handler ─────────────────────────────────────────────────────────

wss.on('connection', (ws, req) => {
  let deviceId = ''
  const remoteIp = req.socket.remoteAddress ?? 'unknown'

  ws.on('message', (raw) => {
    let msg: AgentToRelay
    try { msg = JSON.parse(raw.toString()) } catch { return }

    switch (msg.type) {
      case 'relay:register': {
        if (RELAY_SECRET && msg.token !== RELAY_SECRET) {
          ws.send(JSON.stringify({ type: 'relay:error', message: 'Unauthorized' } satisfies RelayToAgent))
          ws.close(1008, 'Unauthorized')
          console.warn(`[relay] Rejected unauthorized connection from ${remoteIp}`)
          return
        }

        deviceId = msg.deviceId

        const device: DeviceConn = {
          ws,
          deviceId:  msg.deviceId,
          name:      msg.name,
          hostname:  msg.hostname,
          platform:  msg.platform,
          online:    true,
          lastSeen:  Date.now(),
        }
        devices.set(deviceId, device)

        // Acknowledge registration
        ws.send(JSON.stringify({ type: 'relay:registered', ok: true } satisfies RelayToAgent))

        // Tell this device about all currently online peers
        for (const [id, peer] of devices) {
          if (id !== deviceId) {
            ws.send(JSON.stringify({
              type:     'relay:peer:online',
              deviceId: peer.deviceId,
              name:     peer.name,
            } satisfies RelayToAgent))
          }
        }

        // Tell all other devices this one came online
        broadcastPeerEvent(deviceId, {
          type:     'relay:peer:online',
          deviceId: msg.deviceId,
          name:     msg.name,
        })

        console.log(`[relay] Registered: ${msg.name} (${msg.deviceId}) from ${remoteIp}`)
        break
      }

      case 'relay:data': {
        // Route payload from sender → recipient
        // The payload is opaque (base64 binary data or JSON tunnel frames)
        const delivered = sendToDevice(msg.to, {
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
        // Route WebRTC signaling (SDP offer/answer + ICE candidates) for hole-punch
        const delivered = sendToDevice(msg.to, {
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
      devices.delete(deviceId)
      broadcastPeerEvent(deviceId, {
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
