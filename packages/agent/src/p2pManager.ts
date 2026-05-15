import { PeerConnection, DataChannel } from 'node-datachannel'
import type { RTCSignal } from '@sync-tool/shared'

const ICE_SERVERS: string[] = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
]
const P2P_TIMEOUT_MS = 15_000
const CHANNEL_LABEL  = 'sync-tool'

interface PeerState {
  pc:    PeerConnection
  dc?:   DataChannel
  ready: boolean
}

export class P2pManager {
  private peers       = new Map<string, PeerState>()
  private dataHandler = (_from: string, _payload: string): void => {}

  constructor(
    private readonly localId:    string,
    private readonly sendSignal: (to: string, signal: RTCSignal) => void,
  ) {}

  onData(handler: (from: string, payload: string) => void) {
    this.dataHandler = handler
  }

  // Called when relay reports a peer came online
  onPeerOnline(peerId: string) {
    if (this.peers.has(peerId)) return
    // Deterministic: lexicographically smaller id is the offerer — prevents glare
    this.setupPeer(peerId, this.localId < peerId)
  }

  onPeerOffline(peerId: string) {
    this.teardown(peerId)
  }

  onSignal(from: string, signal: RTCSignal) {
    if (!this.peers.has(from)) {
      // Unexpected offer from a peer we haven't seen via relay:peer:online yet
      this.setupPeer(from, false)
    }
    const peer = this.peers.get(from)!
    if (signal.kind === 'offer' || signal.kind === 'answer') {
      peer.pc.setRemoteDescription(signal.sdp, signal.kind)
    } else if (signal.kind === 'ice') {
      peer.pc.addRemoteCandidate(signal.candidate, signal.mid)
    }
  }

  // Returns true if sent via P2P, false if caller should use relay fallback
  send(to: string, payload: string): boolean {
    const peer = this.peers.get(to)
    if (!peer?.ready || !peer.dc) return false
    return peer.dc.sendMessage(payload)
  }

  isReady(to: string): boolean {
    return this.peers.get(to)?.ready ?? false
  }

  closeAll() {
    for (const id of [...this.peers.keys()]) this.teardown(id)
  }

  private setupPeer(peerId: string, offerer: boolean) {
    const shortId = (id: string) => id.slice(0, 8)
    const pc = new PeerConnection(
      `${shortId(this.localId)}->${shortId(peerId)}`,
      { iceServers: ICE_SERVERS },
    )
    const peer: PeerState = { pc, ready: false }
    this.peers.set(peerId, peer)

    pc.onLocalDescription((sdp, type) => {
      if (type === 'offer' || type === 'answer') {
        this.sendSignal(peerId, { kind: type, sdp })
      }
    })

    pc.onLocalCandidate((candidate, mid) => {
      this.sendSignal(peerId, { kind: 'ice', candidate, mid })
    })

    pc.onStateChange((state) => {
      if (state === 'failed' || state === 'disconnected') {
        console.log(`[p2p] ${shortId(peerId)} ${state} — falling back to relay`)
        this.teardown(peerId)
      }
    })

    if (offerer) {
      const dc = pc.createDataChannel(CHANNEL_LABEL)
      peer.dc = dc
      this.wireChannel(peerId, peer, dc)
    } else {
      pc.onDataChannel((dc) => {
        peer.dc = dc
        this.wireChannel(peerId, peer, dc)
      })
    }
  }

  private wireChannel(peerId: string, peer: PeerState, dc: DataChannel) {
    const shortId = peerId.slice(0, 8)
    const timeout = setTimeout(() => {
      if (!peer.ready) {
        console.warn(`[p2p] Timeout connecting to ${shortId} — staying on relay`)
        this.teardown(peerId)
      }
    }, P2P_TIMEOUT_MS)

    dc.onOpen(() => {
      clearTimeout(timeout)
      peer.ready = true
      console.log(`[p2p] Direct channel open with ${shortId} ✓`)
    })

    dc.onMessage((msg) => {
      const payload = typeof msg === 'string'
        ? msg
        : Buffer.isBuffer(msg) ? msg.toString() : Buffer.from(msg as ArrayBuffer).toString()
      this.dataHandler(peerId, payload)
    })

    dc.onClosed(() => {
      clearTimeout(timeout)
      if (peer.ready) {
        peer.ready = false
        console.log(`[p2p] Channel closed with ${shortId} — falling back to relay`)
      }
    })

    dc.onError((err) => {
      clearTimeout(timeout)
      console.error(`[p2p] Channel error with ${shortId}:`, err)
    })
  }

  private teardown(peerId: string) {
    const peer = this.peers.get(peerId)
    if (!peer) return
    this.peers.delete(peerId)
    peer.ready = false
    try { peer.dc?.close() } catch {}
    try { peer.pc.close() } catch {}
  }
}
