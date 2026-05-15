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
 *   On relay: RELAY_TOKENS=home:<token> PORT=3002 pnpm dev:relay
 *   On agent: RELAY_URL=wss://your-vps:3002 RELAY_TOKEN=<token> pnpm dev:agent
 *
 * P2P/STUN signaling is supported as a best-effort optimization. Data falls
 * back to relay when the direct channel is unavailable.
 * Phase C TODO: WireGuard mesh coordinator
 */

import http from 'http'
import crypto from 'crypto'
import { WebSocketServer, WebSocket } from 'ws'
import type { AgentToRelay, RelayToAgent, RelayDevice } from '@sync-tool/shared'

const PORT         = parseInt(process.env.PORT ?? '3002')
const RELAY_SECRET = process.env.RELAY_SECRET  // if set, agents must pass this token
const RELAY_TOKENS = parseRelayTokens(process.env.RELAY_TOKENS)
const RELAY_VERSION = process.env.npm_package_version ?? '0.1.0'

const MAX_WS_MESSAGE_BYTES     = parseEnvInt('RELAY_MAX_WS_MESSAGE_BYTES', 4 * 1024 * 1024)
const MAX_RELAY_PAYLOAD_BYTES  = parseEnvInt('RELAY_MAX_PAYLOAD_BYTES', 3 * 1024 * 1024)
const RATE_LIMIT_WINDOW_MS     = parseEnvInt('RELAY_RATE_LIMIT_WINDOW_MS', 60_000)
const RATE_LIMIT_MAX_MESSAGES  = parseEnvInt('RELAY_RATE_LIMIT_MAX_MESSAGES', 6_000)
const HEARTBEAT_INTERVAL_MS    = parseEnvInt('RELAY_HEARTBEAT_INTERVAL_MS', 30_000)
const startedAt = Date.now()

const metrics = {
  dataMessagesRelayed:   0,
  signalMessagesRelayed: 0,
  bytesRelayed:          0,
  droppedMessages:       0,
  authFailures:          0,
  oversizedMessages:     0,
  rateLimitedClients:    0,
  invalidMessages:       0,
}

const server = http.createServer((req, res) => {
  if (secureTransportRequired() && !requestArrivedSecurely(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Secure transport required' }))
    return
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      version: RELAY_VERSION,
      uptimeMs: Date.now() - startedAt,
      limits: {
        maxWsMessageBytes:    MAX_WS_MESSAGE_BYTES,
        maxRelayPayloadBytes: MAX_RELAY_PAYLOAD_BYTES,
        rateLimitWindowMs:    RATE_LIMIT_WINDOW_MS,
        rateLimitMaxMessages: RATE_LIMIT_MAX_MESSAGES,
      },
      connections: {
        active: wss.clients.size,
        registered: devices.size,
      },
      metrics,
      scopes: scopeStats(),
      devices: [...devices.values()].map((d) => ({
        deviceId: d.deviceId,
        name:     d.name,
        hostname: d.hostname,
        online:   d.online,
        lastSeen: d.lastSeen,
      })),
    }))
  } else if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' })
    res.end(renderMetrics())
  } else {
    res.writeHead(404)
    res.end()
  }
})

const wss = new WebSocketServer({ server, maxPayload: MAX_WS_MESSAGE_BYTES })

// ── Device registry ───────────────────────────────────────────────────────────

interface DeviceConn extends RelayDevice {
  ws: RelayWebSocket
  scope: string
}

const devices = new Map<string, DeviceConn>()  // `${scope}\0${deviceId}` → connection
const rateLimits = new Map<string, RateLimitState>()

// ── Helpers ───────────────────────────────────────────────────────────────────

interface RelayWebSocket extends WebSocket {
  isAlive?: boolean
}

interface RateLimitState {
  windowStartedAt: number
  count: number
}

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

function scopeStats(): Array<{ scope: string; devices: number }> {
  const stats = new Map<string, number>()
  for (const dev of devices.values()) {
    stats.set(dev.scope, (stats.get(dev.scope) ?? 0) + 1)
  }
  return [...stats.entries()].map(([scope, count]) => ({ scope, devices: count }))
}

function renderMetrics(): string {
  const lines = [
    '# HELP sync_tool_relay_uptime_ms Relay process uptime in milliseconds.',
    '# TYPE sync_tool_relay_uptime_ms gauge',
    `sync_tool_relay_uptime_ms ${Date.now() - startedAt}`,
    '# HELP sync_tool_relay_connections Active and registered relay connections.',
    '# TYPE sync_tool_relay_connections gauge',
    `sync_tool_relay_connections{state="active"} ${wss.clients.size}`,
    `sync_tool_relay_connections{state="registered"} ${devices.size}`,
    '# HELP sync_tool_relay_messages_total Relay messages handled by type.',
    '# TYPE sync_tool_relay_messages_total counter',
    `sync_tool_relay_messages_total{type="data"} ${metrics.dataMessagesRelayed}`,
    `sync_tool_relay_messages_total{type="signal"} ${metrics.signalMessagesRelayed}`,
    '# HELP sync_tool_relay_bytes_relayed_total Relay payload bytes forwarded.',
    '# TYPE sync_tool_relay_bytes_relayed_total counter',
    `sync_tool_relay_bytes_relayed_total ${metrics.bytesRelayed}`,
    '# HELP sync_tool_relay_dropped_messages_total Relay messages dropped because the target was unavailable or outside scope.',
    '# TYPE sync_tool_relay_dropped_messages_total counter',
    `sync_tool_relay_dropped_messages_total ${metrics.droppedMessages}`,
    '# HELP sync_tool_relay_auth_failures_total Relay authentication failures.',
    '# TYPE sync_tool_relay_auth_failures_total counter',
    `sync_tool_relay_auth_failures_total ${metrics.authFailures}`,
    '# HELP sync_tool_relay_oversized_messages_total Relay messages rejected by size limits.',
    '# TYPE sync_tool_relay_oversized_messages_total counter',
    `sync_tool_relay_oversized_messages_total ${metrics.oversizedMessages}`,
    '# HELP sync_tool_relay_rate_limited_clients_total Relay clients disconnected by rate limiting.',
    '# TYPE sync_tool_relay_rate_limited_clients_total counter',
    `sync_tool_relay_rate_limited_clients_total ${metrics.rateLimitedClients}`,
    '# HELP sync_tool_relay_invalid_messages_total Relay messages rejected by protocol validation.',
    '# TYPE sync_tool_relay_invalid_messages_total counter',
    `sync_tool_relay_invalid_messages_total ${metrics.invalidMessages}`,
  ]

  for (const stat of scopeStats()) {
    lines.push(`sync_tool_relay_scope_devices{scope="${escapeMetricLabel(stat.scope)}"} ${stat.devices}`)
  }

  return `${lines.join('\n')}\n`
}

function escapeMetricLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

function withinSizeLimit(value: unknown): boolean {
  const bytes = Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
  return bytes <= MAX_RELAY_PAYLOAD_BYTES
}

function closeWithError(ws: WebSocket, message: string, code = 1008) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'relay:error', message } satisfies RelayToAgent))
    ws.close(code, message)
  }
}

function rejectInvalidMessage(ws: WebSocket, reason: string) {
  metrics.invalidMessages++
  closeWithError(ws, `Invalid relay message: ${reason}`, 1008)
}

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const current = rateLimits.get(key)
  if (!current || now - current.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(key, { windowStartedAt: now, count: 1 })
    return true
  }
  current.count++
  return current.count <= RATE_LIMIT_MAX_MESSAGES
}

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function validateAgentMessage(value: unknown): string | null {
  if (!isRecord(value)) return 'expected object'
  switch (value.type) {
    case 'relay:register':
      if (!isNonEmptyString(value.deviceId)) return 'deviceId is required'
      if (!isNonEmptyString(value.name)) return 'name is required'
      if (!isNonEmptyString(value.hostname)) return 'hostname is required'
      if (!isNonEmptyString(value.platform)) return 'platform is required'
      if (value.token !== undefined && typeof value.token !== 'string') return 'token must be a string'
      return null

    case 'relay:data':
      if (!isNonEmptyString(value.to)) return 'to is required'
      if (typeof value.payload !== 'string') return 'payload must be a string'
      return null

    case 'relay:signal':
      if (!isNonEmptyString(value.to)) return 'to is required'
      return validateSignal(value.signal)

    default:
      return 'unknown type'
  }
}

function validateSignal(value: unknown): string | null {
  if (!isRecord(value)) return 'signal must be an object'
  if (value.kind === 'offer' || value.kind === 'answer') {
    return isNonEmptyString(value.sdp) ? null : 'signal.sdp is required'
  }
  if (value.kind === 'ice') {
    if (typeof value.candidate !== 'string') return 'signal.candidate must be a string'
    if (typeof value.mid !== 'string') return 'signal.mid must be a string'
    return null
  }
  return 'signal.kind is invalid'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

// ── WebSocket handler ─────────────────────────────────────────────────────────

wss.on('connection', (socket, req) => {
  const ws = socket as RelayWebSocket
  let deviceId = ''
  let scope = ''
  const remoteIp = req.socket.remoteAddress ?? 'unknown'
  ws.isAlive = true
  ws.on('pong', () => { ws.isAlive = true })

  if (secureTransportRequired() && !requestArrivedSecurely(req)) {
    ws.close(1008, 'Secure transport required')
    return
  }

  ws.on('message', (raw) => {
    const rateKey = deviceId ? `device:${scope}:${deviceId}` : `ip:${remoteIp}`
    if (!checkRateLimit(rateKey)) {
      metrics.rateLimitedClients++
      closeWithError(ws, 'Rate limit exceeded', 1008)
      console.warn(`[relay] Rate limit exceeded for ${rateKey}`)
      return
    }

    let msg: AgentToRelay
    try {
      const parsed = JSON.parse(raw.toString())
      const validationError = validateAgentMessage(parsed)
      if (validationError) {
        rejectInvalidMessage(ws, validationError)
        return
      }
      msg = parsed
    } catch {
      rejectInvalidMessage(ws, 'malformed JSON')
      return
    }

    switch (msg.type) {
      case 'relay:register': {
        const registration = validateRelayToken(msg.token)
        if (!registration) {
          metrics.authFailures++
          ws.send(JSON.stringify({ type: 'relay:error', message: 'Unauthorized' } satisfies RelayToAgent))
          ws.close(1008, 'Unauthorized')
          console.warn(`[relay] Rejected unauthorized connection from ${remoteIp}`)
          return
        }

        deviceId = msg.deviceId
        scope = registration.scope
        rateLimits.delete(`ip:${remoteIp}`)

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
        if (!withinSizeLimit(msg.payload)) {
          metrics.oversizedMessages++
          closeWithError(ws, 'Relay payload too large', 1009)
          console.warn(`[relay] Rejected oversized data payload from ${deviceId}`)
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
          metrics.droppedMessages++
          console.warn(`[relay] Device ${msg.to} not found or offline, dropped message from ${deviceId}`)
        } else {
          metrics.dataMessagesRelayed++
          metrics.bytesRelayed += Buffer.byteLength(msg.payload, 'utf8')
        }
        break
      }

      case 'relay:signal': {
        if (!scope || !deviceId) {
          ws.close(1008, 'Not registered')
          return
        }
        if (!withinSizeLimit(msg.signal)) {
          metrics.oversizedMessages++
          closeWithError(ws, 'Relay signal too large', 1009)
          console.warn(`[relay] Rejected oversized signal from ${deviceId}`)
          return
        }
        // Route WebRTC signaling (SDP offer/answer + ICE candidates) for hole-punch
        const delivered = sendToDevice(scope, msg.to, {
          type:   'relay:signal',
          from:   deviceId,
          signal: msg.signal,
        })
        if (!delivered) {
          metrics.droppedMessages++
          console.warn(`[relay] Signal target ${msg.to} offline, dropped from ${deviceId}`)
        } else {
          metrics.signalMessagesRelayed++
          metrics.bytesRelayed += Buffer.byteLength(JSON.stringify(msg.signal), 'utf8')
        }
        break
      }
    }
  })

  ws.on('close', () => {
    if (deviceId) {
      devices.delete(deviceKey(scope, deviceId))
      rateLimits.delete(`device:${scope}:${deviceId}`)
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

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    const ws = socket as RelayWebSocket
    if (ws.isAlive === false) {
      ws.terminate()
      continue
    }
    ws.isAlive = false
    ws.ping()
  }
}, HEARTBEAT_INTERVAL_MS)
heartbeat.unref?.()

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[relay] Relay server running on ws://0.0.0.0:${PORT}`)
  console.log(`[relay] Health: http://localhost:${PORT}/health`)
  console.log()
  console.log('  Deploy this on a VPS with a public IP.')
  console.log('  Point agents to it with:  RELAY_URL=wss://your-vps:3002 RELAY_TOKEN=<token>')
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
