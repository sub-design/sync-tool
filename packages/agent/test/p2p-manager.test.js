const assert = require('node:assert/strict')
const test   = require('node:test')

const {
  parseIceServers,
  parseIceTransportPolicy,
  parseOptionalInt,
  P2pManager,
} = require('../dist/p2pManager.js')

const DEFAULT_ICE = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
]

// ── parseIceServers ───────────────────────────────────────────────────────────

test('parseIceServers returns defaults when env is unset', () => {
  assert.deepEqual(parseIceServers(undefined), DEFAULT_ICE)
})

test('parseIceServers returns defaults when env is empty string', () => {
  assert.deepEqual(parseIceServers(''), DEFAULT_ICE)
})

test('parseIceServers parses single STUN server', () => {
  assert.deepEqual(parseIceServers('stun:stun.example.com:3478'), ['stun:stun.example.com:3478'])
})

test('parseIceServers parses comma-separated list and trims whitespace', () => {
  const result = parseIceServers('stun:a.example.com , turn:b.example.com:3478')
  assert.deepEqual(result, ['stun:a.example.com', 'turn:b.example.com:3478'])
})

test('parseIceServers parses TURN URL with credentials', () => {
  const result = parseIceServers('turn:user:pass@turn.example.com:3478')
  assert.deepEqual(result, ['turn:user:pass@turn.example.com:3478'])
})

test('parseIceServers returns defaults when all entries are blank after trim', () => {
  assert.deepEqual(parseIceServers('  ,  ,  '), DEFAULT_ICE)
})

// ── parseIceTransportPolicy ───────────────────────────────────────────────────

test('parseIceTransportPolicy returns "all" when unset', () => {
  assert.equal(parseIceTransportPolicy(undefined), 'all')
})

test('parseIceTransportPolicy returns "relay" for "relay"', () => {
  assert.equal(parseIceTransportPolicy('relay'), 'relay')
})

test('parseIceTransportPolicy returns "all" for unknown values', () => {
  assert.equal(parseIceTransportPolicy('srflx'), 'all')
  assert.equal(parseIceTransportPolicy(''), 'all')
})

// ── parseOptionalInt ──────────────────────────────────────────────────────────

test('parseOptionalInt returns undefined when unset', () => {
  assert.equal(parseOptionalInt(undefined), undefined)
})

test('parseOptionalInt returns undefined for empty string', () => {
  assert.equal(parseOptionalInt(''), undefined)
})

test('parseOptionalInt parses valid positive integer', () => {
  assert.equal(parseOptionalInt('50000'), 50000)
  assert.equal(parseOptionalInt('1'), 1)
})

test('parseOptionalInt returns undefined for zero', () => {
  assert.equal(parseOptionalInt('0'), undefined)
})

test('parseOptionalInt returns undefined for negative values', () => {
  assert.equal(parseOptionalInt('-1'), undefined)
})

test('parseOptionalInt returns undefined for non-numeric strings', () => {
  assert.equal(parseOptionalInt('abc'), undefined)
})

// ── P2pManager (disabled mode) ────────────────────────────────────────────────

test('P2pManager.onPeerOnline is a no-op when P2P_ENABLED is false', () => {
  // Default: P2P_ENABLED is not set → disabled
  const mgr = new P2pManager('local-id', async () => {}, async () => {})
  // Should not throw even though node-datachannel may not be available
  assert.doesNotThrow(() => mgr.onPeerOnline('remote-id'))
})

test('P2pManager.onSignal is a no-op when P2P_ENABLED is false', () => {
  const mgr = new P2pManager('local-id', async () => {}, async () => {})
  assert.doesNotThrow(() => mgr.onSignal('remote-id', { kind: 'ice', candidate: 'candidate:1', mid: '0' }))
})
