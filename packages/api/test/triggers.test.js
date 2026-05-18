const assert = require('node:assert/strict')
const test = require('node:test')

const { canTriggerJob } = require('../dist/triggers.js')

test('canTriggerJob allows watch triggers only for watch jobs', () => {
  assert.equal(canTriggerJob(baseJob({ watch: true }), 'watch'), true)
  assert.equal(canTriggerJob(baseJob({ watch: false }), 'watch'), false)
})

test('canTriggerJob allows folder-connect only when enabled', () => {
  assert.equal(canTriggerJob(baseJob({ autoOptions: { onFolderConnect: true } }), 'folder-connect'), true)
  assert.equal(canTriggerJob(baseJob({ autoOptions: { onFolderConnect: false } }), 'folder-connect'), false)
})

test('canTriggerJob allows logoff only when enabled', () => {
  assert.equal(canTriggerJob(baseJob({ autoOptions: { onLogoff: true } }), 'logoff'), true)
  assert.equal(canTriggerJob(baseJob({ autoOptions: { onLogoff: false } }), 'logoff'), false)
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
