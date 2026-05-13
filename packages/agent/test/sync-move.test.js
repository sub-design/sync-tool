const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { runSync } = require('../dist/sync.js')
const { localBackend } = require('../dist/backends/local.js')

test('bidirectional sync applies source rename on destination without transfer', async () => {
  const result = await runRenameScenario('src')

  assert.equal(result.sync.filesCopied, 0)
  assert.equal(result.sync.bytesTransferred, 0)
  assert.deepEqual(visibleFiles(result.srcFiles), ['renamed.txt'])
  assert.deepEqual(visibleFiles(result.dstFiles), ['renamed.txt'])
  assert.equal(result.nextState.get('renamed.txt')?.checksum, result.checksum)
})

test('bidirectional sync applies destination rename on source without transfer', async () => {
  const result = await runRenameScenario('dst')

  assert.equal(result.sync.filesCopied, 0)
  assert.equal(result.sync.bytesTransferred, 0)
  assert.deepEqual(visibleFiles(result.srcFiles), ['renamed.txt'])
  assert.deepEqual(visibleFiles(result.dstFiles), ['renamed.txt'])
  assert.equal(result.nextState.get('renamed.txt')?.checksum, result.checksum)
})

test('bidirectional sync does not treat ambiguous checksum matches as moves', async () => {
  const result = await runAmbiguousRenameScenario()

  assert.equal(result.sync.filesCopied, 2)
  assert.equal(result.sync.bytesTransferred, result.content.length * 2)
  assert.deepEqual(visibleFiles(result.srcFiles), ['renamed.txt', 'renamed2.txt'])
  assert.deepEqual(visibleFiles(result.dstFiles), ['renamed.txt', 'renamed2.txt'])
})

test('bidirectional sync backfills checksum for skipped files and later uses it for rename detection', async () => {
  const result = await runBackfillThenRenameScenario()

  assert.equal(result.backfillSync.filesCopied, 0)
  assert.equal(result.backfillSync.bytesTransferred, 0)
  assert.equal(result.backfilledChecksum, result.checksum)
  assert.equal(result.renameSync.filesCopied, 0)
  assert.equal(result.renameSync.bytesTransferred, 0)
  assert.deepEqual(visibleFiles(result.srcFiles), ['renamed.txt'])
  assert.deepEqual(visibleFiles(result.dstFiles), ['renamed.txt'])
})

async function runRenameScenario(renameSide) {
  return withTempPair(async ({ srcRoot, dstRoot }) => {
    const content = Buffer.from('same file content for rename detection')
    const checksum = sha256(content)
    const oldSrc = path.join(srcRoot, 'old.txt')
    const oldDst = path.join(dstRoot, 'old.txt')

    await fs.writeFile(oldSrc, content)
    await fs.writeFile(oldDst, content)
    const srcStat = await fs.stat(oldSrc)
    const dstStat = await fs.stat(oldDst)

    if (renameSide === 'src') {
      await fs.rename(oldSrc, path.join(srcRoot, 'renamed.txt'))
    } else {
      await fs.rename(oldDst, path.join(dstRoot, 'renamed.txt'))
    }

    const state = createStateStore(new Map([
      ['old.txt', stateEntry(srcStat, dstStat, checksum)],
    ]))
    const sync = await runBidirectional(srcRoot, dstRoot, state)

    return {
      checksum,
      sync,
      nextState: state.next,
      srcFiles: await fs.readdir(srcRoot),
      dstFiles: await fs.readdir(dstRoot),
    }
  })
}

async function runAmbiguousRenameScenario() {
  return withTempPair(async ({ srcRoot, dstRoot }) => {
    const content = Buffer.from('same file content for rename detection')
    const checksum = sha256(content)
    const stateEntries = new Map()

    for (const name of ['old.txt', 'old2.txt']) {
      const srcPath = path.join(srcRoot, name)
      const dstPath = path.join(dstRoot, name)
      await fs.writeFile(srcPath, content)
      await fs.writeFile(dstPath, content)
      stateEntries.set(name, stateEntry(await fs.stat(srcPath), await fs.stat(dstPath), checksum))
    }

    await fs.rename(path.join(srcRoot, 'old.txt'), path.join(srcRoot, 'renamed.txt'))
    await fs.rename(path.join(srcRoot, 'old2.txt'), path.join(srcRoot, 'renamed2.txt'))

    const state = createStateStore(stateEntries)
    const sync = await runBidirectional(srcRoot, dstRoot, state)

    return {
      content,
      sync,
      srcFiles: await fs.readdir(srcRoot),
      dstFiles: await fs.readdir(dstRoot),
    }
  })
}

async function runBackfillThenRenameScenario() {
  return withTempPair(async ({ srcRoot, dstRoot }) => {
    const content = Buffer.from('legacy synced content without checksum')
    const checksum = sha256(content)
    const oldSrc = path.join(srcRoot, 'old.txt')
    const oldDst = path.join(dstRoot, 'old.txt')

    await fs.writeFile(oldSrc, content)
    await fs.writeFile(oldDst, content)
    const srcStat = await fs.stat(oldSrc)
    const dstStat = await fs.stat(oldDst)
    const legacyState = createStateStore(new Map([
      ['old.txt', stateEntry(srcStat, dstStat, undefined)],
    ]))

    const backfillSync = await runBidirectional(srcRoot, dstRoot, legacyState)
    const backfilledChecksum = legacyState.next.get('old.txt')?.checksum

    await fs.rename(oldSrc, path.join(srcRoot, 'renamed.txt'))
    const renameState = createStateStore(legacyState.next)
    const renameSync = await runBidirectional(srcRoot, dstRoot, renameState)

    return {
      checksum,
      backfillSync,
      backfilledChecksum,
      renameSync,
      srcFiles: await fs.readdir(srcRoot),
      dstFiles: await fs.readdir(dstRoot),
    }
  })
}

async function runBidirectional(srcRoot, dstRoot, state) {
  const now = Date.now()
  return runSync({
    id: `move-test-${crypto.randomUUID()}`,
    name: 'move test',
    source: srcRoot,
    destination: dstRoot,
    direction: 'bidir',
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }, localBackend, localBackend, srcRoot, dstRoot, state)
}

async function withTempPair(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-tool-move-test-'))
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

function createStateStore(initialState) {
  return {
    next: new Map(),
    getJobState() {
      return initialState
    },
    setJobState(_jobId, nextState) {
      this.next = nextState
    },
    clearJob() {},
  }
}

function stateEntry(srcStat, dstStat, checksum) {
  return {
    srcSize: srcStat.size,
    srcMtimeMs: srcStat.mtimeMs,
    dstSize: dstStat.size,
    dstMtimeMs: dstStat.mtimeMs,
    ...(checksum ? { checksum } : {}),
    syncedAt: Date.now(),
  }
}

function visibleFiles(files) {
  return files.filter((file) => file !== '_gsdata_').sort()
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}
