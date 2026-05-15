const assert = require('node:assert/strict')
const test = require('node:test')

const { validateRemoteDeltaRequest } = require('../dist/delta/remote.js')

test('remote delta protocol accepts valid request bodies', () => {
  assert.doesNotThrow(() => validateRemoteDeltaRequest('delta:manifest', {
    root: '/tmp/source',
  }))
  assert.doesNotThrow(() => validateRemoteDeltaRequest('delta:transfer-start', {
    kind: 'full',
    root: '/tmp/destination',
    relativePath: 'file.txt',
    meta: { size: 12, mtimeMs: Date.now() },
  }))
  assert.doesNotThrow(() => validateRemoteDeltaRequest('delta:send-delta', {
    root: '/tmp/source',
    relativePath: 'file.txt',
    targetRoot: '/tmp/destination',
    signature: { blockSize: 65536, blocks: [] },
    mode: 'delta',
  }))
  assert.doesNotThrow(() => validateRemoteDeltaRequest('delta:delete', {
    root: '/tmp/destination',
    relativePath: 'subdir/file.txt',
  }))
})

test('remote delta protocol rejects malformed delta:delete bodies', () => {
  assert.throws(() => validateRemoteDeltaRequest('delta:delete', {
    relativePath: 'file.txt',
  }), /Invalid root/)
  assert.throws(() => validateRemoteDeltaRequest('delta:delete', {
    root: '/tmp/destination',
  }), /Invalid relativePath/)
  assert.throws(() => validateRemoteDeltaRequest('delta:delete', {
    root: '/tmp/destination',
    relativePath: '../escape.txt',
  }), /Invalid relative path/)
})

test('remote delta protocol rejects malformed request bodies', () => {
  assert.throws(() => validateRemoteDeltaRequest('delta:manifest', {}), /Invalid root/)
  assert.throws(() => validateRemoteDeltaRequest('delta:transfer-start', {
    kind: 'other',
    root: '/tmp/destination',
    relativePath: 'file.txt',
    meta: { size: 12, mtimeMs: Date.now() },
  }), /Invalid transfer kind/)
  assert.throws(() => validateRemoteDeltaRequest('delta:transfer-start', {
    kind: 'full',
    root: '/tmp/destination',
    relativePath: '../file.txt',
    meta: { size: -1, mtimeMs: Date.now() },
  }), /Invalid transfer size/)
  assert.throws(() => validateRemoteDeltaRequest('delta:send-delta', {
    root: '/tmp/source',
    relativePath: 'file.txt',
    targetRoot: '/tmp/destination',
    signature: null,
    mode: 'delta',
  }), /Invalid signature/)
  assert.throws(() => validateRemoteDeltaRequest('delta:transfer-chunk', {
    transferId: 'x',
    seq: '0',
    dataBase64: 'abc',
  }), /Invalid seq/)
})
