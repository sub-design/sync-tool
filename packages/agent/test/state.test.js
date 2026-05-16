const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'state-db-'))
process.env.STATE_DIR = stateRoot

const { stateDb } = require('../dist/state.js')

test('stateDb stores each job in an isolated file', () => {
  stateDb.setJobState('job-one', new Map([
    ['one.txt', makeState(1)],
  ]))
  stateDb.setJobState('job-two', new Map([
    ['two.txt', makeState(2)],
  ]))

  assert.equal(fs.existsSync(path.join(stateRoot, 'jobs', 'job-one.json')), true)
  assert.equal(fs.existsSync(path.join(stateRoot, 'jobs', 'job-two.json')), true)
  assert.deepEqual([...stateDb.getJobState('job-one').keys()], ['one.txt'])
  assert.deepEqual([...stateDb.getJobState('job-two').keys()], ['two.txt'])
})

test('stateDb falls back to legacy all-jobs state when per-job file is absent', () => {
  const jobId = 'legacy-job'
  fs.writeFileSync(path.join(stateRoot, 'agent-state.json'), JSON.stringify({
    [jobId]: {
      'legacy.txt': makeState(3),
    },
  }), 'utf8')

  const loaded = stateDb.getJobState(jobId)

  assert.equal(loaded.get('legacy.txt').srcSize, 3)
})

test('stateDb returns cached state for repeated reads in one process', () => {
  const jobId = 'cached-job'
  const file = path.join(stateRoot, 'jobs', `${jobId}.json`)
  fs.writeFileSync(file, JSON.stringify({ 'first.txt': makeState(4) }), 'utf8')

  const first = stateDb.getJobState(jobId)
  fs.writeFileSync(file, JSON.stringify({ 'second.txt': makeState(5) }), 'utf8')
  const second = stateDb.getJobState(jobId)

  assert.equal(first, second)
  assert.equal(second.has('first.txt'), true)
  assert.equal(second.has('second.txt'), false)
})

test('stateDb.clearJob removes the per-job file and clears cache', () => {
  const jobId = 'clear-job'
  const file = path.join(stateRoot, 'jobs', `${jobId}.json`)
  stateDb.setJobState(jobId, new Map([
    ['old.txt', makeState(6)],
  ]))

  stateDb.clearJob(jobId)
  fs.writeFileSync(file, JSON.stringify({ 'new.txt': makeState(7) }), 'utf8')

  assert.equal(fs.existsSync(file), true)
  assert.deepEqual([...stateDb.getJobState(jobId).keys()], ['new.txt'])
})

function makeState(size) {
  return {
    srcSize: size,
    srcMtimeMs: 1_000 + size,
    dstSize: size,
    dstMtimeMs: 1_000 + size,
    syncedAt: Date.now(),
  }
}
