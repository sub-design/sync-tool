const assert = require('node:assert/strict')
const os     = require('node:os')
const test   = require('node:test')

// Allow transfer handlers to use OS temp dir as a sync root.
process.env.SYNC_ALLOWED_ROOTS = os.tmpdir()

const {
  handleTransferStart,
  handleTransferChunk,
  handleTransferFinish,
  handleTransferAbort,
} = require('../dist/delta/remote.js')

// ── tests ─────────────────────────────────────────────────────────────────────

test('abort with unknown transferId is idempotent', async () => {
  const result = await handleTransferAbort('does-not-exist-' + Date.now())
  assert.deepEqual(result, { ok: true })
})

test('start then abort cleans up temp dir', async () => {
  const root = os.tmpdir()
  const { transferId } = await handleTransferStart('full', root, 'probe.txt', { size: 0, mtimeMs: Date.now() })
  assert.ok(typeof transferId === 'string' && transferId.length > 0)

  // Abort should clean up the session temp directory
  const result = await handleTransferAbort(transferId)
  assert.deepEqual(result, { ok: true })

  // Second abort on same transferId is also safe
  const result2 = await handleTransferAbort(transferId)
  assert.deepEqual(result2, { ok: true })
})

test('start then chunk then abort cleans up', async () => {
  const root = os.tmpdir()
  const payload = Buffer.from('hello relay').toString('base64')
  const { transferId } = await handleTransferStart('full', root, 'probe2.txt', { size: 11, mtimeMs: Date.now() })

  await handleTransferChunk(transferId, 0, payload)

  const result = await handleTransferAbort(transferId)
  assert.deepEqual(result, { ok: true })

  // Session is gone — next abort is idempotent
  const result2 = await handleTransferAbort(transferId)
  assert.deepEqual(result2, { ok: true })
})

test('chunk with wrong sequence number throws', async () => {
  const root = os.tmpdir()
  const { transferId } = await handleTransferStart('full', root, 'probe3.txt', { size: 0, mtimeMs: Date.now() })

  // seq=0 is fine
  await handleTransferChunk(transferId, 0, Buffer.from('a').toString('base64'))

  // seq=2 skips over seq=1 — should throw
  await assert.rejects(
    () => handleTransferChunk(transferId, 2, Buffer.from('b').toString('base64')),
    /Unexpected transfer chunk sequence/,
  )

  await handleTransferAbort(transferId)
})

test('finish with unknown transferId throws', async () => {
  await assert.rejects(
    () => handleTransferFinish('ghost-transfer-' + Date.now()),
    /Unknown transfer/,
  )
})
