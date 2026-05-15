const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const nodeFs = require('node:fs')
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

test('bidirectional sync treats rename plus content change as copy, not pure move', async () => {
  const result = await runRenameAndModifyScenario()

  assert.equal(result.sync.filesCopied, 1)
  assert.equal(result.sync.bytesTransferred, result.newContent.length)
  assert.deepEqual(visibleFiles(result.srcFiles), ['renamed.txt'])
  assert.deepEqual(visibleFiles(result.dstFiles), ['renamed.txt'])
  assert.equal(result.dstContent, result.newContent.toString())
})

test('checksum backfill does not persist checksum when a file changes while hashing', async () => {
  const result = await runChangedWhileHashingScenario()

  assert.equal(result.sync.filesCopied, 0)
  assert.equal(result.sync.bytesTransferred, 0)
  assert.equal(result.nextState.get('stable.txt')?.checksum, undefined)
  assert.match(result.sync.errors.join('\n'), /checksum backfill skipped: source changed while hashing/)
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

async function runRenameAndModifyScenario() {
  return withTempPair(async ({ srcRoot, dstRoot }) => {
    const oldContent = Buffer.from('old content for rename detection')
    const newContent = Buffer.from('modified content after rename')
    const oldSrc = path.join(srcRoot, 'old.txt')
    const oldDst = path.join(dstRoot, 'old.txt')

    await fs.writeFile(oldSrc, oldContent)
    await fs.writeFile(oldDst, oldContent)
    const srcStat = await fs.stat(oldSrc)
    const dstStat = await fs.stat(oldDst)
    const state = createStateStore(new Map([
      ['old.txt', stateEntry(srcStat, dstStat, sha256(oldContent))],
    ]))

    const renamedSrc = path.join(srcRoot, 'renamed.txt')
    await fs.rename(oldSrc, renamedSrc)
    await fs.writeFile(renamedSrc, newContent)

    const sync = await runBidirectional(srcRoot, dstRoot, state)
    return {
      newContent,
      sync,
      srcFiles: await fs.readdir(srcRoot),
      dstFiles: await fs.readdir(dstRoot),
      dstContent: await fs.readFile(path.join(dstRoot, 'renamed.txt'), 'utf8'),
    }
  })
}

async function runChangedWhileHashingScenario() {
  return withTempPair(async ({ srcRoot, dstRoot }) => {
    const content = Buffer.from('legacy synced content without checksum')
    const srcPath = path.join(srcRoot, 'stable.txt')
    const dstPath = path.join(dstRoot, 'stable.txt')
    await fs.writeFile(srcPath, content)
    await fs.writeFile(dstPath, content)

    const state = createStateStore(new Map([
      ['stable.txt', stateEntry(await fs.stat(srcPath), await fs.stat(dstPath), undefined)],
    ]))
    const mutatingBackend = {
      ...localBackend,
      async read(filePath, options) {
        const stream = await localBackend.read(filePath, options)
        if (filePath === srcPath) {
          stream.once('data', () => {
            nodeFs.appendFileSync(srcPath, ' changed')
          })
        }
        return stream
      },
    }

    const sync = await runBidirectional(srcRoot, dstRoot, state, mutatingBackend, localBackend)
    return {
      sync,
      nextState: state.next,
    }
  })
}

async function runBidirectional(srcRoot, dstRoot, state, srcBackend = localBackend, dstBackend = localBackend) {
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
  }, srcBackend, dstBackend, srcRoot, dstRoot, state)
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
  return files.filter((file) => file !== '_syncdata_').sort()
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}
