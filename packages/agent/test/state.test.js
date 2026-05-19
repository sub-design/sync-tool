const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'state-db-'))
process.env.STATE_DIR = stateRoot

const { stateDb } = require('../dist/state.js')

test('stateDb stores each job in a JSON file and keeps jobs isolated', () => {
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

test('stateDb reads existing per-job JSON state', () => {
  const jobId = 'per-job-legacy'
  const jobsDir = path.join(stateRoot, 'jobs')
  fs.mkdirSync(jobsDir, { recursive: true })
  fs.writeFileSync(path.join(jobsDir, `${jobId}.json`), JSON.stringify({
    'per-job.txt': makeState(3),
  }), 'utf8')

  const loaded = stateDb.getJobState(jobId)

  assert.equal(loaded.get('per-job.txt').srcSize, 3)
  assert.equal(stateDb.getJobState(jobId), loaded)
})

test('stateDb falls back to legacy all-jobs state when per-job file is absent', () => {
  const jobId = 'all-jobs-legacy'
  fs.writeFileSync(path.join(stateRoot, 'agent-state.json'), JSON.stringify({
    [jobId]: {
      'legacy.txt': makeState(4),
    },
  }), 'utf8')

  const loaded = stateDb.getJobState(jobId)

  assert.equal(loaded.get('legacy.txt').srcSize, 4)
})

test('stateDb returns cached state for repeated reads in one process', () => {
  const jobId = 'cached-job'
  stateDb.setJobState(jobId, new Map([
    ['first.txt', makeState(5)],
  ]))

  const first = stateDb.getJobState(jobId)
  first.set('memory-only.txt', makeState(6))
  const second = stateDb.getJobState(jobId)

  assert.equal(first, second)
  assert.equal(second.has('memory-only.txt'), true)
})

test('stateDb.clearJob clears persisted per-job state and prevents legacy fallback from restoring it', () => {
  const jobId = 'clear-job'
  const jobsDir = path.join(stateRoot, 'jobs')
  fs.mkdirSync(jobsDir, { recursive: true })
  fs.writeFileSync(path.join(jobsDir, `${jobId}.json`), JSON.stringify({
    'legacy-after-clear.txt': makeState(7),
  }), 'utf8')

  stateDb.setJobState(jobId, new Map([
    ['current.txt', makeState(8)],
  ]))
  stateDb.clearJob(jobId)

  assert.deepEqual([...stateDb.getJobState(jobId).keys()], [])
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
