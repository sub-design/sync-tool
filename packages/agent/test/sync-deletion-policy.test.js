const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { runSync } = require('../dist/sync.js')
const { localBackend } = require('../dist/backends/local.js')

test('backup policy keeps files deleted from source in destination', async () => {
  await withTempPair(async ({ srcRoot, dstRoot }) => {
    const state = createStateStore()
    await fs.writeFile(path.join(srcRoot, 'kept.txt'), 'backup copy')

    await runOneWay(srcRoot, dstRoot, state, 'backup', 'backup-keeps')
    await fs.rm(path.join(srcRoot, 'kept.txt'))

    const result = await runOneWay(srcRoot, dstRoot, state, 'backup', 'backup-keeps')

    assert.equal(await readText(path.join(dstRoot, 'kept.txt')), 'backup copy')
    assert.equal(result.filesDeleted ?? 0, 0)
  })
})

test('backup-with-deletes removes only files previously synced by the job', async () => {
  await withTempPair(async ({ srcRoot, dstRoot }) => {
    const state = createStateStore()
    await fs.writeFile(path.join(srcRoot, 'tracked.txt'), 'tracked')
    await fs.writeFile(path.join(dstRoot, 'destination-only.txt'), 'keep me')

    await runOneWay(srcRoot, dstRoot, state, 'backup-with-deletes', 'backup-with-deletes')
    await fs.rm(path.join(srcRoot, 'tracked.txt'))

    const result = await runOneWay(srcRoot, dstRoot, state, 'backup-with-deletes', 'backup-with-deletes')

    await assert.rejects(fs.stat(path.join(dstRoot, 'tracked.txt')), { code: 'ENOENT' })
    assert.equal(await readText(path.join(dstRoot, 'destination-only.txt')), 'keep me')
    assert.equal(result.filesDeleted, 1)
  })
})

test('backup-with-deletes keeps tracked destination files changed after sync', async () => {
  await withTempPair(async ({ srcRoot, dstRoot }) => {
    const state = createStateStore()
    await fs.writeFile(path.join(srcRoot, 'changed-in-destination.txt'), 'source')

    await runOneWay(srcRoot, dstRoot, state, 'backup-with-deletes', 'backup-with-deletes-changed')
    await fs.writeFile(path.join(dstRoot, 'changed-in-destination.txt'), 'destination edit')
    await fs.rm(path.join(srcRoot, 'changed-in-destination.txt'))

    const result = await runOneWay(srcRoot, dstRoot, state, 'backup-with-deletes', 'backup-with-deletes-changed')

    assert.equal(await readText(path.join(dstRoot, 'changed-in-destination.txt')), 'destination edit')
    assert.equal(result.filesDeleted ?? 0, 0)
  })
})

test('mirror policy removes destination-only files immediately', async () => {
  await withTempPair(async ({ srcRoot, dstRoot }) => {
    const state = createStateStore()
    await fs.writeFile(path.join(srcRoot, 'source.txt'), 'source')
    await fs.writeFile(path.join(dstRoot, 'extra.txt'), 'remove me')

    const result = await runOneWay(srcRoot, dstRoot, state, 'mirror', 'mirror')

    assert.equal(await readText(path.join(dstRoot, 'source.txt')), 'source')
    await assert.rejects(fs.stat(path.join(dstRoot, 'extra.txt')), { code: 'ENOENT' })
    assert.equal(result.filesDeleted, 1)
  })
})

async function runOneWay(srcRoot, dstRoot, state, deletionPolicy, id) {
  const now = Date.now()
  return runSync({
    id,
    name: id,
    source: srcRoot,
    destination: dstRoot,
    direction: 'ltr',
    transferMode: 'full',
    deletionPolicy,
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }, localBackend, localBackend, srcRoot, dstRoot, state)
}

async function withTempPair(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-tool-delete-policy-test-'))
  try {
    const srcRoot = path.join(root, 'src')
    const dstRoot = path.join(root, 'dst')
    await fs.mkdir(srcRoot)
    await fs.mkdir(dstRoot)
    return await fn({ srcRoot, dstRoot })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

function createStateStore() {
  const states = new Map()
  return {
    getJobState(jobId) {
      return states.get(jobId) ?? new Map()
    },
    setJobState(jobId, nextState) {
      states.set(jobId, nextState)
    },
    clearJob(jobId) {
      states.delete(jobId)
    },
  }
}

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8')
}
