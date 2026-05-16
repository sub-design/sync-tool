import dgram from 'node:dgram'
import os from 'node:os'

const DISCOVERY_PORT    = parseInt(process.env.LAN_DISCOVERY_PORT ?? '33338', 10)

// Returns directed broadcast addresses for all active IPv4 interfaces.
// This ensures discovery works when VPN, Docker, or multiple NICs are present —
// 255.255.255.255 (limited broadcast) is dropped by most routers and virtual interfaces.
function getDirectedBroadcasts(): string[] {
  const addrs: string[] = []
  for (const iface of Object.values(os.networkInterfaces())) {
    if (!iface) continue
    for (const addr of iface) {
      if (addr.family !== 'IPv4' || addr.internal || !addr.netmask) continue
      const ipParts   = addr.address.split('.').map(Number)
      const maskParts = addr.netmask.split('.').map(Number)
      const broadcast = ipParts.map((b, i) => (b | (~maskParts[i] & 0xff))).join('.')
      addrs.push(broadcast)
    }
  }
  return addrs.length > 0 ? addrs : ['255.255.255.255']
}
const BROADCAST_INTERVAL_MS = 5_000
const PEER_TTL_MS           = 30_000

interface SynMessage {
  type:      'syn'
  deviceId:  string
  name:      string
  scope:     string
  peerPort:  number
}

interface AckMessage {
  type:      'ack'
  deviceId:  string
  name:      string
  peerPort:  number
}

export interface LanPeer {
  deviceId:  string
  name:      string
  host:      string
  port:      number
  lastSeen:  number
}

export class LanDiscovery {
  private socket?:     dgram.Socket
  private peers =      new Map<string, LanPeer>()
  private intervalId?: NodeJS.Timeout
  private sweepId?:    NodeJS.Timeout
  private callbacks:   Array<(deviceId: string, peer: LanPeer) => void> = []

  constructor(
    private readonly deviceId:  string,
    private readonly name:      string,
    private readonly scope:     string,
    private readonly peerPort:  number,
  ) {}

  start() {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    this.socket = socket

    socket.on('error', (err) => {
      console.error('[lan] UDP socket error:', err.message)
    })

    socket.on('message', (msg, rinfo) => {
      let data: SynMessage | AckMessage
      try {
        data = JSON.parse(msg.toString())
      } catch {
        return
      }

      if (data.type === 'syn') {
        if (data.deviceId === this.deviceId) return
        if (data.scope !== this.scope) return
        const ack: AckMessage = { type: 'ack', deviceId: this.deviceId, name: this.name, peerPort: this.peerPort }
        const buf = Buffer.from(JSON.stringify(ack))
        socket.send(buf, DISCOVERY_PORT, rinfo.address)
        this.record(data.deviceId, data.name, rinfo.address, data.peerPort)
      } else if (data.type === 'ack') {
        if (data.deviceId === this.deviceId) return
        this.record(data.deviceId, data.name, rinfo.address, data.peerPort)
      }
    })

    socket.bind(DISCOVERY_PORT, () => {
      socket.setBroadcast(true)
      console.log(`[lan] Discovery listening on UDP ${DISCOVERY_PORT}`)
      this.broadcast()
    })

    this.intervalId = setInterval(() => this.broadcast(), BROADCAST_INTERVAL_MS)
    this.sweepId    = setInterval(() => this.sweep(),     PEER_TTL_MS)
  }

  stop() {
    clearInterval(this.intervalId)
    clearInterval(this.sweepId)
    try { this.socket?.close() } catch {}
    this.socket = undefined
  }

  getPeer(deviceId: string): { host: string; port: number } | undefined {
    const peer = this.peers.get(deviceId)
    if (!peer) return undefined
    if (Date.now() - peer.lastSeen > PEER_TTL_MS) {
      this.peers.delete(deviceId)
      return undefined
    }
    return { host: peer.host, port: peer.port }
  }

  onPeer(cb: (deviceId: string, peer: LanPeer) => void) {
    this.callbacks.push(cb)
  }

  private broadcast() {
    if (!this.socket) return
    const syn: SynMessage = {
      type: 'syn', deviceId: this.deviceId, name: this.name, scope: this.scope, peerPort: this.peerPort,
    }
    const buf = Buffer.from(JSON.stringify(syn))
    for (const addr of getDirectedBroadcasts()) {
      this.socket.send(buf, DISCOVERY_PORT, addr, (err) => {
        if (err) console.error(`[lan] Broadcast error to ${addr}:`, err.message)
      })
    }
  }

  private record(deviceId: string, name: string, host: string, port: number) {
    const isNew = !this.peers.has(deviceId)
    const peer: LanPeer = { deviceId, name, host, port, lastSeen: Date.now() }
    this.peers.set(deviceId, peer)
    if (isNew) {
      console.log(`[lan] Discovered peer "${name}" (${deviceId.slice(0, 8)}) at ${host}:${port}`)
      for (const cb of this.callbacks) cb(deviceId, peer)
    } else {
      this.peers.get(deviceId)!.lastSeen = Date.now()
    }
  }

  private sweep() {
    const now = Date.now()
    for (const [id, peer] of this.peers) {
      if (now - peer.lastSeen > PEER_TTL_MS) {
        console.log(`[lan] Peer "${peer.name}" (${id.slice(0, 8)}) expired`)
        this.peers.delete(id)
      }
    }
  }
}

export function getLanScope(token: string | undefined): string {
  // Peers on the same LAN with the same relay token are in the same scope
  return token ?? os.hostname()
}
