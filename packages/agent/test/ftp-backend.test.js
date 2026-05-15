const assert = require('node:assert/strict')
const test   = require('node:test')

const { createFtpBackend } = require('../dist/backends/ftp.js')

// Access the private helper via the compiled module (it's not exported, so
// we test it indirectly through a known timestamp).
// Instead we export-test the public surface only.

test('createFtpBackend parses host, port, user and rootPath from URL', () => {
  const { backend, rootPath } = createFtpBackend('ftp://alice:s3cr3t@files.example.com:2121/home/alice')
  assert.equal(rootPath, '/home/alice')
  assert.equal(backend['host'], 'files.example.com')
  assert.equal(backend['port'], 2121)
  assert.equal(backend['username'], 'alice')
  assert.equal(backend['password'], 's3cr3t')
})

test('createFtpBackend defaults port to 21 for ftp://', () => {
  const { backend } = createFtpBackend('ftp://u:p@h/path')
  assert.equal(backend['port'], 21)
  assert.equal(backend['secure'], false)
})

test('createFtpBackend defaults port to 990 and sets implicit TLS for ftps:// on default port', () => {
  const { backend } = createFtpBackend('ftps://u:p@h/path')
  assert.equal(backend['port'], 990)
  assert.equal(backend['secure'], 'implicit')
})

test('createFtpBackend uses explicit TLS for ftps:// on non-990 port', () => {
  const { backend } = createFtpBackend('ftps://u:p@h:21/path')
  assert.equal(backend['port'], 21)
  assert.equal(backend['secure'], true)
})

test('createFtpBackend uses anonymous credentials when omitted', () => {
  const { backend } = createFtpBackend('ftp://files.example.com/pub')
  assert.equal(backend['username'], 'anonymous')
  assert.equal(backend['password'], 'anonymous@')
})

test('createFtpBackend normalizes rootPath', () => {
  const { rootPath } = createFtpBackend('ftp://u:p@h//double//slashes')
  assert.equal(rootPath, '/double/slashes')
})

test('createFtpBackend exposes delete method', () => {
  const { backend } = createFtpBackend('ftp://u:p@h/p')
  assert.equal(typeof backend.delete, 'function')
})
