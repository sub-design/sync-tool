const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const test = require('node:test')
const WebSocket = require('ws')

const { assertAllowedPath, assertAllowedLocalEndpoint } = require('../dist/fileGuard.js')
const workspaceRoot = path.resolve(__dirname, '../../..')

test('allowed path guard permits home and configured roots', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-tool-guard-'))
  const previousRoots = process.env.SYNC_ALLOWED_ROOTS
  try {
    process.env.SYNC_ALLOWED_ROOTS = root
    await fs.mkdir(path.join(root, 'nested'))

    const allowed = await assertAllowedPath(path.join(root, 'nested'))
    assert.equal(allowed.resolvedPath, path.join(root, 'nested'))

    const futureDestination = await assertAllowedPath(path.join(root, 'future', 'dst'))
    assert.equal(futureDestination.resolvedPath, path.join(root, 'future', 'dst'))
  } finally {
    restoreEnv('SYNC_ALLOWED_ROOTS', previousRoots)
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('allowed path guard rejects escaped absolute paths and symlink escapes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-tool-guard-'))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-tool-outside-'))
  const previousRoots = process.env.SYNC_ALLOWED_ROOTS
  try {
    process.env.SYNC_ALLOWED_ROOTS = root
    await fs.symlink(outside, path.join(root, 'outside-link'))

    await assert.rejects(assertAllowedPath('/etc'), /outside allowed roots/)
    await assert.rejects(assertAllowedPath(path.join(root, 'outside-link')), /outside allowed roots/)
    await assert.rejects(assertAllowedLocalEndpoint(`file://${path.join(root, 'outside-link')}`), /outside allowed roots/)
  } finally {
    restoreEnv('SYNC_ALLOWED_ROOTS', previousRoots)
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

test('API WebSocket auth accepts headers and subprotocols but rejects query tokens by default', { timeout: 15_000 }, async (t) => {
  if (!(await hasDatabase())) return t.skip('PostgreSQL is not available')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-tool-api-security-'))
  const port = await freePort()
  const api = startProcess('api', ['packages/api/dist/index.js'], {
    PORT: String(port),
    DATA_DIR: path.join(root, 'api-data'),
  })
  try {
    await waitFor(async () => (await getJson(`http://127.0.0.1:${port}/api/health`)).ok === true, 'api health')
    const registered = await postJson(`http://127.0.0.1:${port}/api/auth/register`, {
      email: 'ws-auth@example.com',
      password: 'correct horse battery staple',
    })
    const device = await postJson(`http://127.0.0.1:${port}/api/devices`, { name: 'agent' }, registered.token)

    const headerAgent = await connectWs(`ws://127.0.0.1:${port}/agent`, {
      headers: { Authorization: `Bearer ${device.token}` },
    })
    headerAgent.close()

    const browser = await connectWs(`ws://127.0.0.1:${port}`, [`auth.${base64Url(registered.token)}`])
    browser.close()

    await assert.rejects(
      connectWs(`ws://127.0.0.1:${port}/agent?token=${encodeURIComponent(device.token)}`),
      /Unexpected server response: 401/,
    )
  } finally {
    await stopProcess(api)
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('new jobs default to encryption while explicit existing settings are preserved', { timeout: 15_000 }, async (t) => {
  if (!(await hasDatabase())) return t.skip('PostgreSQL is not available')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-tool-job-defaults-'))
  const port = await freePort()
  const api = startProcess('api', ['packages/api/dist/index.js'], {
    PORT: String(port),
    DATA_DIR: path.join(root, 'api-data'),
  })
  try {
    await waitFor(async () => (await getJson(`http://127.0.0.1:${port}/api/health`)).ok === true, 'api health')
    const registered = await postJson(`http://127.0.0.1:${port}/api/auth/register`, {
      email: 'defaults@example.com',
      password: 'correct horse battery staple',
    })

    const defaultJob = await postJson(`http://127.0.0.1:${port}/api/jobs`, {
      name: 'default encryption',
      source: path.join(root, 'src'),
      destination: path.join(root, 'dst'),
      direction: 'ltr',
    }, registered.token)
    assert.equal(defaultJob.reliability.encryptionEnabled, true)

    const explicitJob = await postJson(`http://127.0.0.1:${port}/api/jobs`, {
      name: 'explicit encryption off',
      source: path.join(root, 'src2'),
      destination: path.join(root, 'dst2'),
      direction: 'ltr',
      reliability: { encryptionEnabled: false },
    }, registered.token)
    assert.equal(explicitJob.reliability.encryptionEnabled, false)

    const updated = await requestJson('PATCH', `http://127.0.0.1:${port}/api/jobs/${explicitJob.id}`, {
      name: 'still explicit encryption off',
    }, registered.token)
    assert.equal(updated.reliability.encryptionEnabled, false)
  } finally {
    await stopProcess(api)
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('agent tokens expose expiry, can rotate, and write audit events', { timeout: 15_000 }, async (t) => {
  if (!(await hasDatabase())) return t.skip('PostgreSQL is not available')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-tool-token-audit-'))
  const port = await freePort()
  const api = startProcess('api', ['packages/api/dist/index.js'], {
    PORT: String(port),
    DATA_DIR: path.join(root, 'api-data'),
    AGENT_TOKEN_TTL_DAYS: '7',
  })
  try {
    await waitFor(async () => (await getJson(`http://127.0.0.1:${port}/api/health`)).ok === true, 'api health')
    const registered = await postJson(`http://127.0.0.1:${port}/api/auth/register`, {
      email: 'audit@example.com',
      password: 'correct horse battery staple',
    })

    const device = await postJson(`http://127.0.0.1:${port}/api/devices`, { name: 'rotating-agent' }, registered.token)
    assert.equal(typeof device.token, 'string')
    assert.equal(typeof device.expiresAt, 'number')

    const listed = await getJson(`http://127.0.0.1:${port}/api/devices`, registered.token)
    assert.equal(listed.length, 1)
    assert.equal(listed[0].expiresAt, device.expiresAt)

    const rotated = await postJson(`http://127.0.0.1:${port}/api/devices/${device.id}/rotate`, {}, registered.token)
    assert.equal(typeof rotated.token, 'string')
    assert.notEqual(rotated.token, device.token)

    const listedAfterRotate = await getJson(`http://127.0.0.1:${port}/api/devices`, registered.token)
    assert.deepEqual(listedAfterRotate.map((entry) => entry.id), [rotated.id])

    const audit = await getJson(`http://127.0.0.1:${port}/api/audit`, registered.token)
    const actions = audit.map((entry) => entry.action)
    assert.ok(actions.includes('agent_token.created'))
    assert.ok(actions.includes('agent_token.rotated'))
  } finally {
    await stopProcess(api)
    await fs.rm(root, { recursive: true, force: true })
  }
})

function restoreEnv(name, value) {
  if (value == null) delete process.env[name]
  else process.env[name] = value
}

function startProcess(name, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: workspaceRoot,
    env: { ...process.env, ALLOW_OPEN_REGISTRATION: 'true', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.output = ''
  child.stdout.on('data', (chunk) => { child.output += chunk.toString() })
  child.stderr.on('data', (chunk) => { child.output += chunk.toString() })
  child.on('exit', (code, signal) => {
    child.output += `\n[${name}] exited code=${code} signal=${signal}\n`
  })
  return child
}

async function stopProcess(child) {
  if (child.exitCode != null || child.signalCode != null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(2_000).then(() => {
      if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
    }),
  ])
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  return address.port
}

async function hasDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://localhost/sync_tool')
  const port = url.port ? Number(url.port) : 5432
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: url.hostname, port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, 500)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

async function getJson(url, token) {
  return requestJson('GET', url, undefined, token)
}

async function postJson(url, body, token) {
  return requestJson('POST', url, body, token)
}

async function requestJson(method, url, body, token) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(`${method} ${url} failed: ${response.status} ${JSON.stringify(payload)}`)
  return payload
}

function connectWs(url, options) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

async function waitFor(check, label) {
  const deadline = Date.now() + 8_000
  let lastError
  while (Date.now() < deadline) {
    try {
      if (await check()) return
    } catch (err) {
      lastError = err
    }
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

function base64Url(value) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
