const assert = require('node:assert/strict')
const test   = require('node:test')

const { createSmbBackend, createNfsBackend } = require('../dist/backends/mounted.js')

// ── SMB ───────────────────────────────────────────────────────────────────────

test('createSmbBackend parses host, share, and rootPath from URL', () => {
  const { backend, rootPath } = createSmbBackend('smb://fileserver/share/documents')
  assert.equal(rootPath, '/documents')
  assert.ok(backend.constructor.name === 'MountedNetworkBackend')
})

test('createSmbBackend sets rootPath to / when only share is given', () => {
  const { rootPath } = createSmbBackend('smb://fileserver/share')
  assert.equal(rootPath, '/')
})

test('createSmbBackend throws when share is missing', () => {
  assert.throws(() => createSmbBackend('smb://fileserver'), /share name/)
})

test('createSmbBackend exposes delete method', () => {
  const { backend } = createSmbBackend('smb://fileserver/share/path')
  assert.equal(typeof backend.delete, 'function')
})

test('createSmbBackend exposes move method', () => {
  const { backend } = createSmbBackend('smb://fileserver/share/path')
  assert.equal(typeof backend.move, 'function')
})

test('createSmbBackend exposes walk method', () => {
  const { backend } = createSmbBackend('smb://fileserver/share/path')
  assert.equal(typeof backend.walk, 'function')
})

// ── NFS ───────────────────────────────────────────────────────────────────────

test('createNfsBackend parses host and export from URL', () => {
  const { rootPath } = createNfsBackend('nfs://nas/export/home/alice')
  // default: first path segment (/export) is the export, remainder is rootPath
  assert.equal(rootPath, '/home/alice')
})

test('createNfsBackend uses explicit export param', () => {
  const { rootPath } = createNfsBackend('nfs://nas/export/home/alice?export=/export')
  assert.equal(rootPath, '/home/alice')
})

test('createNfsBackend throws when export path is missing', () => {
  assert.throws(() => createNfsBackend('nfs://nas'), /export path/)
})

test('createNfsBackend exposes delete method', () => {
  const { backend } = createNfsBackend('nfs://nas/export/data')
  assert.equal(typeof backend.delete, 'function')
})

test('createNfsBackend exposes move method', () => {
  const { backend } = createNfsBackend('nfs://nas/export/data')
  assert.equal(typeof backend.move, 'function')
})
