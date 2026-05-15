const assert = require('node:assert/strict')
const os     = require('node:os')
const path   = require('node:path')
const test   = require('node:test')

const { createSftpBackend } = require('../dist/backends/sftp.js')

test('createSftpBackend parses host, port, user and rootPath from URL', () => {
  const { backend, rootPath } = createSftpBackend('sftp://alice:s3cr3t@backup.example.com:2222/home/alice/sync')
  assert.equal(rootPath, '/home/alice/sync')
  assert.equal(backend['host'], 'backup.example.com')
  assert.equal(backend['port'], 2222)
  assert.equal(backend['username'], 'alice')
  assert.equal(backend['password'], 's3cr3t')
  assert.equal(backend['keyPath'], undefined)
})

test('createSftpBackend defaults port to 22', () => {
  const { backend } = createSftpBackend('sftp://bob@files.example.com/data')
  assert.equal(backend['port'], 22)
})

test('createSftpBackend normalizes rootPath', () => {
  const { rootPath } = createSftpBackend('sftp://u@h//double//slashes')
  assert.equal(rootPath, '/double/slashes')
})

test('createSftpBackend uses key auth when no password', () => {
  delete process.env.SFTP_KEY_PATH
  const { backend } = createSftpBackend('sftp://carol@keys.example.com/backup')
  assert.equal(backend['password'], undefined)
  assert.equal(backend['keyPath'], path.join(os.homedir(), '.ssh', 'id_rsa'))
})

test('createSftpBackend uses SFTP_KEY_PATH env when set', () => {
  process.env.SFTP_KEY_PATH = '/custom/id_ed25519'
  const { backend } = createSftpBackend('sftp://dave@keys.example.com/backup')
  assert.equal(backend['keyPath'], '/custom/id_ed25519')
  delete process.env.SFTP_KEY_PATH
})

test('createSftpBackend prefers ?keyPath URL param over env', () => {
  process.env.SFTP_KEY_PATH = '/env/key'
  const { backend } = createSftpBackend('sftp://eve@keys.example.com/backup?keyPath=/url/key')
  assert.equal(backend['keyPath'], '/url/key')
  delete process.env.SFTP_KEY_PATH
})

test('createSftpBackend exposes delete method', () => {
  const { backend } = createSftpBackend('sftp://u@h/p')
  assert.equal(typeof backend.delete, 'function')
})
