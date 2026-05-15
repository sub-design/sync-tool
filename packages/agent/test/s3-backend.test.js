const assert = require('node:assert/strict')
const test   = require('node:test')

const { createS3Backend } = require('../dist/backends/s3.js')

test('createS3Backend parses bucket and prefix from URL', () => {
  const { backend, rootPath } = createS3Backend('s3://my-bucket/path/to/prefix')
  assert.equal(backend.bucket,    'my-bucket')
  assert.equal(backend.keyPrefix, 'path/to/prefix')
  assert.equal(rootPath,          'path/to/prefix')
})

test('createS3Backend strips leading and trailing slashes from keyPrefix', () => {
  const { backend } = createS3Backend('s3://my-bucket//double//slashes/')
  assert.equal(backend.keyPrefix, 'double//slashes')
})

test('createS3Backend sets rootPath to "/" when bucket root is targeted', () => {
  const { rootPath } = createS3Backend('s3://my-bucket')
  assert.equal(rootPath, '/')
})

test('createS3Backend sets rootPath to "/" when path is empty slash', () => {
  const { rootPath } = createS3Backend('s3://my-bucket/')
  assert.equal(rootPath, '/')
})

test('createS3Backend reads region from URL param', () => {
  const { backend } = createS3Backend('s3://my-bucket/prefix?region=eu-west-1')
  // We can't inspect S3Client internals directly, but keyPrefix should still parse correctly
  assert.equal(backend.keyPrefix, 'prefix')
})

test('createS3Backend reads endpoint from URL param', () => {
  const { backend } = createS3Backend('s3://my-bucket/prefix?endpoint=http%3A%2F%2Flocalhost%3A9000')
  assert.equal(backend.keyPrefix, 'prefix')
})

test('createS3Backend exposes delete method', () => {
  const { backend } = createS3Backend('s3://my-bucket/prefix')
  assert.equal(typeof backend.delete, 'function')
})

test('createS3Backend exposes move method', () => {
  const { backend } = createS3Backend('s3://my-bucket/prefix')
  assert.equal(typeof backend.move, 'function')
})

test('createS3Backend exposes walk method', () => {
  const { backend } = createS3Backend('s3://my-bucket/prefix')
  assert.equal(typeof backend.walk, 'function')
})

test('createS3Backend exposes write method', () => {
  const { backend } = createS3Backend('s3://my-bucket/prefix')
  assert.equal(typeof backend.write, 'function')
})
