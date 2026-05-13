const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const { shouldIgnoreWatchPath, watchPathsForJob } = require('../dist/watch.js')

test('watchPathsForJob watches local paths for untargeted jobs', () => {
  const job = baseJob({
    direction: 'bidir',
    source: '/tmp/source',
    destination: '/tmp/destination',
    watch: true,
  })

  assert.deepEqual(watchPathsForJob(job, 'device-a'), ['/tmp/source', '/tmp/destination'])
})

test('watchPathsForJob watches only this device side for targeted bidirectional jobs', () => {
  const job = baseJob({
    direction: 'bidir',
    source: '/tmp/source',
    destination: '/tmp/destination',
    sourceDeviceId: 'source-device',
    destinationDeviceId: 'destination-device',
    watch: true,
  })

  assert.deepEqual(watchPathsForJob(job, 'source-device'), ['/tmp/source'])
  assert.deepEqual(watchPathsForJob(job, 'destination-device'), ['/tmp/destination'])
  assert.deepEqual(watchPathsForJob(job, 'other-device'), [])
})

test('watchPathsForJob ignores disabled jobs and non-local URLs', () => {
  assert.deepEqual(watchPathsForJob(baseJob({ source: '/tmp/source', watch: false }), 'device-a'), [])
  assert.deepEqual(watchPathsForJob(baseJob({ source: 'sftp://host/path', destination: '/tmp/destination', watch: true }), 'device-a'), [])
})

test('shouldIgnoreWatchPath ignores sync metadata and partial files', () => {
  assert.equal(shouldIgnoreWatchPath(path.join('/tmp/root', '_gsdata_', '_saved_', 'file.txt')), true)
  assert.equal(shouldIgnoreWatchPath('/tmp/root/file.sync-tool-part.txt'), true)
  assert.equal(shouldIgnoreWatchPath('/tmp/root/file.sync-tool-part'), true)
  assert.equal(shouldIgnoreWatchPath('/tmp/root/file.txt'), false)
})

function baseJob(overrides) {
  const now = Date.now()
  return {
    id: 'job',
    name: 'job',
    source: '/tmp/source',
    destination: '/tmp/destination',
    direction: 'ltr',
    status: 'idle',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
