const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const { FolderConnectMonitor, JobWatcher, folderConnectPathsForJob, shouldIgnoreWatchPath, watchPathsForJob } = require('../dist/watch.js')

test('watchPathsForJob watches local paths for untargeted jobs', () => {
  const job = baseJob({
    direction: 'bidir',
    source: '/tmp/source',
    destination: '/tmp/destination',
    watch: true,
  })

  assert.deepEqual(watchPathsForJob(job, 'device-a'), ['/tmp/source', '/tmp/destination'])
})

test('watchPathsForJob resolves local path variables before watching', () => {
  const job = baseJob({
    source: '{UserHome}/Sync Source',
    destination: '{Downloads}/Sync Destination',
    watch: true,
  })

  assert.deepEqual(watchPathsForJob(job, 'device-a'), [
    path.join(require('node:os').homedir(), 'Sync Source'),
  ])
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

test('folderConnectPathsForJob uses local paths only when folder-connect is enabled', () => {
  assert.deepEqual(folderConnectPathsForJob(baseJob({
    source: '/tmp/source',
    autoOptions: { onFolderConnect: true },
  }), 'device-a'), ['/tmp/source'])
  assert.deepEqual(folderConnectPathsForJob(baseJob({
    source: '/tmp/source',
    autoOptions: { onFolderConnect: false },
  }), 'device-a'), [])
  assert.deepEqual(folderConnectPathsForJob(baseJob({
    source: 'sftp://host/path',
    destination: '/tmp/destination',
    autoOptions: { onFolderConnect: true },
  }), 'device-a'), [])
})

test('shouldIgnoreWatchPath ignores sync metadata and partial files', () => {
  assert.equal(shouldIgnoreWatchPath(path.join('/tmp/root', '_syncdata_', '_saved_', 'file.txt')), true)
  assert.equal(shouldIgnoreWatchPath('/tmp/root/file.sync-tool-part.txt'), true)
  assert.equal(shouldIgnoreWatchPath('/tmp/root/file.sync-tool-part'), true)
  assert.equal(shouldIgnoreWatchPath('/tmp/root/file.txt'), false)
})

test('JobWatcher reports changedPath for a normal debounce window', async () => {
  const calls = []
  const watcher = new JobWatcher('device-a', (jobId, changedPath) => {
    calls.push({ jobId, changedPath })
  }, 10, 10)

  watcher.scheduleTrigger('job-a', '/tmp/source/file.txt')
  await delay(30)

  assert.deepEqual(calls, [{ jobId: 'job-a', changedPath: '/tmp/source/file.txt' }])
})

test('JobWatcher coalesces event storms into one full scan trigger', async () => {
  const calls = []
  const warnings = []
  const originalWarn = console.warn
  console.warn = (message) => warnings.push(String(message))
  try {
    const watcher = new JobWatcher('device-a', (jobId, changedPath) => {
      calls.push({ jobId, changedPath })
    }, 10, 2)

    watcher.scheduleTrigger('job-a', '/tmp/source/a.txt')
    watcher.scheduleTrigger('job-a', '/tmp/source/b.txt')
    watcher.scheduleTrigger('job-a', '/tmp/source/c.txt')
    await delay(30)
  } finally {
    console.warn = originalWarn
  }

  assert.deepEqual(calls, [{ jobId: 'job-a', changedPath: undefined }])
  assert.ok(warnings.some((message) => message.includes('received 3 filesystem events')))
})

test('FolderConnectMonitor triggers once when a missing path becomes available', async () => {
  const calls = []
  const availability = new Map([['/tmp/source', false]])
  const monitor = new FolderConnectMonitor('device-a', (jobId) => {
    calls.push(jobId)
  }, 60_000, 100, async (candidate) => availability.get(candidate) ?? false)

  try {
    monitor.sync([baseJob({ autoOptions: { onFolderConnect: true } })])
    await delay(10)
    availability.set('/tmp/source', true)
    await monitor.pollNow()
    await delay(130)

    assert.deepEqual(calls, ['job'])
  } finally {
    monitor.close()
  }
})

test('FolderConnectMonitor does not trigger for a path already available at startup', async () => {
  const calls = []
  const monitor = new FolderConnectMonitor('device-a', (jobId) => {
    calls.push(jobId)
  }, 60_000, 100, async () => true)

  try {
    monitor.sync([baseJob({ autoOptions: { onFolderConnect: true } })])
    await delay(150)
    await monitor.pollNow()
    await delay(150)

    assert.deepEqual(calls, [])
  } finally {
    monitor.close()
  }
})

test('FolderConnectMonitor does not retrigger while a path remains available', async () => {
  const calls = []
  const availability = new Map([['/tmp/source', false]])
  const monitor = new FolderConnectMonitor('device-a', (jobId) => {
    calls.push(jobId)
  }, 60_000, 100, async (candidate) => availability.get(candidate) ?? false)

  try {
    monitor.sync([baseJob({ autoOptions: { onFolderConnect: true } })])
    await delay(10)
    availability.set('/tmp/source', true)
    await monitor.pollNow()
    await monitor.pollNow()
    await monitor.pollNow()
    await delay(130)

    assert.deepEqual(calls, ['job'])
  } finally {
    monitor.close()
  }
})

test('FolderConnectMonitor retriggers after a path disappears and reappears', async () => {
  const calls = []
  const availability = new Map([['/tmp/source', false]])
  const monitor = new FolderConnectMonitor('device-a', (jobId) => {
    calls.push(jobId)
  }, 60_000, 100, async (candidate) => availability.get(candidate) ?? false)

  try {
    monitor.sync([baseJob({ autoOptions: { onFolderConnect: true } })])
    await delay(10)
    availability.set('/tmp/source', true)
    await monitor.pollNow()
    await delay(130)
    availability.set('/tmp/source', false)
    await monitor.pollNow()
    availability.set('/tmp/source', true)
    await monitor.pollNow()
    await delay(130)

    assert.deepEqual(calls, ['job', 'job'])
  } finally {
    monitor.close()
  }
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
