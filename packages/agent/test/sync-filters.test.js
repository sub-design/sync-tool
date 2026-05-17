const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { runImportSync, runSync } = require('../dist/sync.js')
const { localBackend } = require('../dist/backends/local.js')

test('sync filters include matching files by basename', async () => {
  await withTempPair(async ({ srcRoot, dstRoot }) => {
    await fs.mkdir(path.join(srcRoot, 'nested'))
    await fs.writeFile(path.join(srcRoot, 'nested', 'photo.jpg'), 'jpg bytes')
    await fs.writeFile(path.join(srcRoot, 'nested', 'notes.txt'), 'text bytes')

    const result = await runOneWay(srcRoot, dstRoot, 'filter-include', {
      include: ['*.jpg'],
    })

    assert.equal(result.filesCopied, 1)
    assert.equal(await readText(path.join(dstRoot, 'nested', 'photo.jpg')), 'jpg bytes')
    await assert.rejects(fs.stat(path.join(dstRoot, 'nested', 'notes.txt')), { code: 'ENOENT' })
  })
})

test('sync filters exclude paths after include rules', async () => {
  await withTempPair(async ({ srcRoot, dstRoot }) => {
    await fs.mkdir(path.join(srcRoot, 'node_modules'), { recursive: true })
    await fs.writeFile(path.join(srcRoot, 'app.js'), 'app')
    await fs.writeFile(path.join(srcRoot, 'node_modules', 'dep.js'), 'dep')

    const result = await runOneWay(srcRoot, dstRoot, 'filter-exclude', {
      include: ['*.js'],
      exclude: ['node_modules/**'],
    })

    assert.equal(result.filesCopied, 1)
    assert.equal(await readText(path.join(dstRoot, 'app.js')), 'app')
    await assert.rejects(fs.stat(path.join(dstRoot, 'node_modules', 'dep.js')), { code: 'ENOENT' })
  })
})

test('sync filters skip files larger than maxFileSizeMb', async () => {
  await withTempPair(async ({ srcRoot, dstRoot }) => {
    await fs.writeFile(path.join(srcRoot, 'small.bin'), Buffer.alloc(512))
    await fs.writeFile(path.join(srcRoot, 'large.bin'), Buffer.alloc(2048))

    const result = await runOneWay(srcRoot, dstRoot, 'filter-size', {
      maxFileSizeMb: 0.001,
    })

    assert.equal(result.filesCopied, 1)
    assert.equal((await fs.stat(path.join(dstRoot, 'small.bin'))).size, 512)
    await assert.rejects(fs.stat(path.join(dstRoot, 'large.bin')), { code: 'ENOENT' })
  })
})

test('mirror sync ignores excluded destination files instead of deleting them', async () => {
  await withTempPair(async ({ srcRoot, dstRoot }) => {
    const state = createStateStore()
    await fs.writeFile(path.join(srcRoot, 'app.js'), 'app')
    await fs.mkdir(path.join(dstRoot, 'node_modules'), { recursive: true })
    await fs.writeFile(path.join(dstRoot, 'node_modules', 'dep.js'), 'existing dep')

    const result = await runOneWay(srcRoot, dstRoot, 'filter-mirror', {
      exclude: ['node_modules/**'],
    }, state, 'mirror')

    assert.equal(result.filesDeleted ?? 0, 0)
    assert.equal(await readText(path.join(dstRoot, 'node_modules', 'dep.js')), 'existing dep')
  })
})

test('import mode honors source filters before media import', async () => {
  await withTempPair(async ({ srcRoot, dstRoot }) => {
    const keep = path.join(srcRoot, 'keep.jpg')
    const skip = path.join(srcRoot, 'skip.jpg')
    const mtime = new Date(2022, 0, 5, 10, 0, 0)
    await fs.writeFile(keep, 'keep')
    await fs.writeFile(skip, 'skip')
    await fs.utimes(keep, mtime, mtime)
    await fs.utimes(skip, mtime, mtime)

    const now = Date.now()
    const result = await runImportSync({
      id: 'filter-import',
      name: 'filter-import',
      source: srcRoot,
      destination: dstRoot,
      direction: 'ltr',
      jobMode: 'import',
      transferMode: 'full',
      deletionPolicy: 'backup',
      reliability: { encryptionEnabled: false },
      filters: { exclude: ['skip.jpg'] },
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    }, localBackend, localBackend, srcRoot, dstRoot)

    assert.equal(result.filesCopied, 1)
    assert.equal(await readText(path.join(dstRoot, '2022', '2022-01-05', 'keep.jpg')), 'keep')
    await assert.rejects(fs.stat(path.join(dstRoot, '2022', '2022-01-05', 'skip.jpg')), { code: 'ENOENT' })
  })
})

async function runOneWay(srcRoot, dstRoot, id, filters, state = createStateStore(), deletionPolicy = 'backup') {
  const now = Date.now()
  return runSync({
    id,
    name: id,
    source: srcRoot,
    destination: dstRoot,
    direction: 'ltr',
    transferMode: 'full',
    deletionPolicy,
    filters,
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }, localBackend, localBackend, srcRoot, dstRoot, state)
}

async function withTempPair(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-tool-filters-test-'))
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
