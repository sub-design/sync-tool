/**
 * Deterministic tests for unidirectional remote delete logic.
 *
 * We call runRemoteDeltaSync with a stub relay so no real network is needed.
 * The stub captures delta:delete calls; we assert which files get deleted
 * under each deletion policy.
 */
const assert = require('node:assert/strict')
const os     = require('node:os')
const fs     = require('node:fs')
const path   = require('node:path')
const test   = require('node:test')

process.env.SYNC_ALLOWED_ROOTS = os.tmpdir()
process.env.STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-delete-state-'))

const { runRemoteDeltaSync } = require('../dist/delta/remote.js')
const { stateDb }            = require('../dist/state.js')

// ── stub relay ───────────────────────────────────────────────────────────────

function makeRelay(manifestEntries, deleted) {
  return {
    onRequest:  () => {},
    onEvent:    () => {},
    request: async (deviceId, method, body) => {
      if (method === 'delta:manifest') return { entries: manifestEntries, total: manifestEntries.length }
      if (method === 'delta:delete')   { deleted.push(body.relativePath); return { ok: true } }
      if (method === 'delta:transfer-start') return { transferId: 'stub-' + Date.now() }
      if (method === 'delta:transfer-finish') return { ok: true }
      if (method === 'delta:transfer-abort')  return { ok: true }
      throw new Error(`Unexpected relay method in test: ${method}`)
    },
    event: async () => {},
    getTransportMode: () => 'relay',
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function makeJob(overrides = {}) {
  return {
    id:                  'test-job-' + Math.random().toString(36).slice(2),
    name:                'test',
    source:              os.tmpdir(),
    destination:         '/remote/dst',
    direction:           'ltr',
    transferMode:        'full',
    sourceDeviceId:      null,
    destinationDeviceId: 'dst-device',
    watch:               false,
    ...overrides,
  }
}

function makeManifestEntry(relativePath, size = 10, mtimeMs = 1000) {
  return { relativePath, absolutePath: `/remote/dst/${relativePath}`, size, mtimeMs }
}

// ── tests ──────────────────────────────────────────────────────────────────────

test('backup policy never deletes destination files', async () => {
  const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'rdel-'))
  const job     = makeJob({ source: tmpDir, deletionPolicy: 'backup' })
  const deleted = []
  // Source is empty; destination has one file.
  const relay   = makeRelay([makeManifestEntry('orphan.txt')], deleted)
  const state   = stateDb

  const result = await runRemoteDeltaSync(job, relay, state)

  assert.deepEqual(deleted, [], 'backup policy must not delete anything')
  assert.equal(result.transportMode, 'relay')
  fs.rmSync(tmpDir, { recursive: true })
})

test('mirror policy deletes destination files absent from source', async () => {
  const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'rdel-'))
  // Create one file in source so the job is valid; orphan.txt is only on dst.
  fs.writeFileSync(path.join(tmpDir, 'keep.txt'), 'hello')
  const job     = makeJob({ source: tmpDir, deletionPolicy: 'mirror' })
  const deleted = []
  const relay   = makeRelay([
    makeManifestEntry('keep.txt', 5, Date.now()),
    makeManifestEntry('orphan.txt', 20, Date.now()),
  ], deleted)

  await runRemoteDeltaSync(job, relay, stateDb)

  assert.ok(deleted.includes('orphan.txt'), 'mirror must delete orphan.txt')
  assert.ok(!deleted.includes('keep.txt'), 'mirror must keep keep.txt')
  fs.rmSync(tmpDir, { recursive: true })
})

test('backup-with-deletes policy only deletes previously-tracked files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdel-'))
  const jobId  = 'bwd-job-' + Math.random().toString(36).slice(2)

  // Seed prevState: only 'tracked.txt' was seen in a previous sync.
  const prevState = new Map()
  prevState.set('tracked.txt', {
    srcSize: 10, srcMtimeMs: 1000,
    dstSize: 10, dstMtimeMs: 1000,
    syncedAt: Date.now() - 60_000,
  })
  stateDb.setJobState(jobId, prevState)

  const job     = makeJob({ id: jobId, source: tmpDir, deletionPolicy: 'backup-with-deletes' })
  const deleted = []
  // Destination has: tracked.txt (unchanged since last sync) + new-file.txt (never tracked).
  const relay   = makeRelay([
    makeManifestEntry('tracked.txt',  10, 1000),
    makeManifestEntry('new-file.txt', 20, 2000),
  ], deleted)

  await runRemoteDeltaSync(job, relay, stateDb)

  assert.ok(deleted.includes('tracked.txt'),  'must delete tracked.txt (seen before, removed from src)')
  assert.ok(!deleted.includes('new-file.txt'), 'must not delete new-file.txt (never tracked)')
  fs.rmSync(tmpDir, { recursive: true })
})

test('state is saved after unidirectional sync', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdel-'))
  fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello')
  const job     = makeJob({ source: tmpDir })
  const deleted = []
  const relay   = makeRelay([], deleted)

  await runRemoteDeltaSync(job, relay, stateDb)

  const saved = stateDb.getJobState(job.id)
  assert.ok(saved.has('a.txt'), 'state must record a.txt after sync')
  fs.rmSync(tmpDir, { recursive: true })
})
