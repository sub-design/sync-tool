const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { resolveBackend } = require('../dist/backends/resolve.js')
const { resolvePathVariables, resolveUserPath } = require('../dist/pathVariables.js')

test('resolvePathVariables expands built-in path variables', () => {
  assert.equal(resolvePathVariables('{UserHome}/Projects'), path.join(os.homedir(), 'Projects'))
  assert.equal(resolvePathVariables('{Downloads}/Archive'), path.join(os.homedir(), 'Downloads', 'Archive'))
})

test('resolvePathVariables expands device and environment variables', () => {
  const oldLocation = process.env.DEVICE_LOCATION
  const oldBucket = process.env.SYNC_TEST_BUCKET
  try {
    process.env.DEVICE_LOCATION = 'Belgrade'
    process.env.SYNC_TEST_BUCKET = 'backups'

    assert.equal(resolvePathVariables('{Location}/{DeviceId}', { deviceId: 'agent-a' }), 'Belgrade/agent-a')
    assert.equal(resolvePathVariables('s3://bucket/{Env:SYNC_TEST_BUCKET}'), 's3://bucket/backups')
  } finally {
    restoreEnv('DEVICE_LOCATION', oldLocation)
    restoreEnv('SYNC_TEST_BUCKET', oldBucket)
  }
})

test('resolvePathVariables rejects unknown variables', () => {
  assert.throws(() => resolvePathVariables('{MissingVariable}/data'), /Unknown path variable/)
})

test('resolveUserPath and resolveBackend apply variables to local roots', () => {
  const expected = path.join(os.homedir(), 'SyncRoot')
  assert.equal(resolveUserPath('{UserHome}/SyncRoot'), expected)
  assert.equal(resolveBackend('{UserHome}/SyncRoot').rootPath, expected)
})

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
