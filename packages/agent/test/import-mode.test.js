const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { runImportSync, runSync } = require('../dist/sync.js')
const { localBackend } = require('../dist/backends/local.js')

test('import mode uses EXIF date folders and preserves original filename', async () => {
  await withTempPair(async ({ srcRoot, dstRoot }) => {
    await fs.writeFile(path.join(srcRoot, 'IMG_0001.JPG'), jpegWithDateTimeOriginal('2022:01:05 12:34:56'))

    const result = await runImport(srcRoot, dstRoot, 'import-exif')

    assert.equal(result.filesCopied, 1)
    assert.deepEqual(await readFile(path.join(dstRoot, '2022', '2022-01-05', 'IMG_0001.JPG')), await readFile(path.join(srcRoot, 'IMG_0001.JPG')))
  })
})

test('import mode falls back to file mtime when EXIF is missing', async () => {
  await withTempPair(async ({ srcRoot, dstRoot }) => {
    const sourcePath = path.join(srcRoot, 'clip.mp4')
    const mtime = new Date(2021, 6, 9, 10, 11, 12)
    await fs.writeFile(sourcePath, 'video bytes')
    await fs.utimes(sourcePath, mtime, mtime)

    const result = await runImport(srcRoot, dstRoot, 'import-mtime')

    assert.equal(result.filesCopied, 1)
    assert.equal(await readText(path.join(dstRoot, '2021', '2021-07-09', 'clip.mp4')), 'video bytes')
  })
})

test('import mode skips unsupported files', async () => {
  await withTempPair(async ({ srcRoot, dstRoot }) => {
    await fs.writeFile(path.join(srcRoot, 'notes.txt'), 'not media')

    const result = await runImport(srcRoot, dstRoot, 'import-unsupported')

    assert.equal(result.filesCopied, 0)
    assert.equal(result.filesSkipped, 1)
    assert.deepEqual(await visibleTree(dstRoot), [])
  })
})

test('import mode skips identical destination collisions', async () => {
  await withTempPair(async ({ srcRoot, dstRoot }) => {
    const sourcePath = path.join(srcRoot, 'same.jpg')
    const destDir = path.join(dstRoot, '2020', '2020-02-03')
    const destPath = path.join(destDir, 'same.jpg')
    const mtime = new Date(2020, 1, 3, 4, 5, 6)
    await fs.writeFile(sourcePath, 'same bytes')
    await fs.utimes(sourcePath, mtime, mtime)
    await fs.mkdir(destDir, { recursive: true })
    await fs.writeFile(destPath, 'same bytes')
    await fs.utimes(destPath, mtime, mtime)

    const result = await runImport(srcRoot, dstRoot, 'import-identical-collision')

    assert.equal(result.filesCopied, 0)
    assert.equal(result.filesSkipped, 1)
    assert.equal(await readText(destPath), 'same bytes')
  })
})

test('import mode errors on different destination collisions without overwrite', async () => {
  await withTempPair(async ({ srcRoot, dstRoot }) => {
    const sourcePath = path.join(srcRoot, 'collision.jpg')
    const destDir = path.join(dstRoot, '2020', '2020-02-03')
    const destPath = path.join(destDir, 'collision.jpg')
    const mtime = new Date(2020, 1, 3, 4, 5, 6)
    await fs.writeFile(sourcePath, 'source bytes')
    await fs.utimes(sourcePath, mtime, mtime)
    await fs.mkdir(destDir, { recursive: true })
    await fs.writeFile(destPath, 'existing different bytes')

    const result = await runImport(srcRoot, dstRoot, 'import-different-collision')

    assert.equal(result.filesCopied, 0)
    assert.equal(result.filesErrored, 1)
    assert.match(result.errors.join('\n'), /destination already has a different file/)
    assert.equal(await readText(destPath), 'existing different bytes')
  })
})

test('missing jobMode still uses existing sync behavior', async () => {
  await withTempPair(async ({ srcRoot, dstRoot }) => {
    const state = createStateStore()
    await fs.writeFile(path.join(srcRoot, 'nested.jpg'), 'plain sync')

    const now = Date.now()
    const result = await runSync({
      id: 'sync-default-mode',
      name: 'sync-default-mode',
      source: srcRoot,
      destination: dstRoot,
      direction: 'ltr',
      transferMode: 'full',
      deletionPolicy: 'backup',
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    }, localBackend, localBackend, srcRoot, dstRoot, state)

    assert.equal(result.filesCopied, 1)
    assert.equal(await readText(path.join(dstRoot, 'nested.jpg')), 'plain sync')
  })
})

async function runImport(srcRoot, dstRoot, id) {
  const now = Date.now()
  return runImportSync({
    id,
    name: id,
    source: srcRoot,
    destination: dstRoot,
    direction: 'ltr',
    jobMode: 'import',
    transferMode: 'full',
    deletionPolicy: 'backup',
    reliability: { encryptionEnabled: false },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }, localBackend, localBackend, srcRoot, dstRoot)
}

async function withTempPair(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-tool-import-mode-test-'))
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

function jpegWithDateTimeOriginal(value) {
  const date = Buffer.from(`${value}\0`, 'ascii')
  assert.equal(date.length, 20)

  const tiff = Buffer.alloc(44 + date.length)
  tiff.write('II', 0, 'ascii')
  tiff.writeUInt16LE(42, 2)
  tiff.writeUInt32LE(8, 4)

  tiff.writeUInt16LE(1, 8)
  tiff.writeUInt16LE(0x8769, 10)
  tiff.writeUInt16LE(4, 12)
  tiff.writeUInt32LE(1, 14)
  tiff.writeUInt32LE(26, 18)
  tiff.writeUInt32LE(0, 22)

  tiff.writeUInt16LE(1, 26)
  tiff.writeUInt16LE(0x9003, 28)
  tiff.writeUInt16LE(2, 30)
  tiff.writeUInt32LE(date.length, 32)
  tiff.writeUInt32LE(44, 36)
  tiff.writeUInt32LE(0, 40)
  date.copy(tiff, 44)

  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff])
  const app1Length = Buffer.alloc(2)
  app1Length.writeUInt16BE(payload.length + 2, 0)

  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    app1Length,
    payload,
    Buffer.from([0xff, 0xd9]),
  ])
}

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8')
}

async function readFile(filePath) {
  return fs.readFile(filePath)
}

async function visibleTree(root) {
  const entries = []
  async function walk(dir, prefix = '') {
    const items = await fs.readdir(dir, { withFileTypes: true })
    for (const item of items) {
      const rel = prefix ? path.join(prefix, item.name) : item.name
      entries.push(rel)
      if (item.isDirectory()) await walk(path.join(dir, item.name), rel)
    }
  }
  await walk(root)
  return entries.sort()
}
