const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const test = require('node:test')

const workspaceRoot = path.resolve(__dirname, '../../..')

test('watch=true job auto-runs through API and agent after local file change', { timeout: 20_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-tool-watch-e2e-'))
  const processes = []
  try {
    const port = await freePort()
    const srcRoot = path.join(root, 'src')
    const dstRoot = path.join(root, 'dst')
    await fs.mkdir(srcRoot)
    await fs.mkdir(dstRoot)

    const api = startProcess('api', ['packages/api/dist/index.js'], {
      PORT: String(port),
      DATA_DIR: path.join(root, 'api-data'),
    })
    processes.push(api)
    await waitFor(async () => {
      const health = await getJson(`http://127.0.0.1:${port}/api/health`)
      return health.ok === true
    }, 'api health')

    const agent = startProcess('agent', ['packages/agent/dist/index.js'], {
      API_URL: `ws://127.0.0.1:${port}/agent`,
      DEVICE_ID: 'watch-e2e-agent',
      STATE_DIR: path.join(root, 'agent-state'),
      WATCH_DEBOUNCE_MS: '150',
    })
    processes.push(agent)
    try {
      await waitFor(async () => {
        const health = await getJson(`http://127.0.0.1:${port}/api/health`)
        return health.agents?.some((entry) => entry.deviceId === 'watch-e2e-agent')
      }, 'agent registration')
    } catch (err) {
      throw new Error(`${err.message}\n\nAPI output:\n${api.output}\n\nAgent output:\n${agent.output}`)
    }

    const job = await postJson(`http://127.0.0.1:${port}/api/jobs`, {
      name: 'watch e2e',
      source: srcRoot,
      destination: dstRoot,
      direction: 'ltr',
      transferMode: 'full',
      watch: true,
    })
    assert.equal(job.watch, true)

    await waitFor(() => agent.output.includes(`[watch] Watching job "watch e2e" (${job.id})`), 'watcher registration')

    const changedPath = path.join(srcRoot, 'watched.txt')
    await fs.writeFile(changedPath, 'changed by watcher')

    await waitFor(async () => {
      try {
        return await fs.readFile(path.join(dstRoot, 'watched.txt'), 'utf8') === 'changed by watcher'
      } catch {
        return false
      }
    }, 'watched file sync')

    const finalJob = await getJson(`http://127.0.0.1:${port}/api/jobs/${job.id}`)
    assert.equal(finalJob.status, 'completed')
  } finally {
    await Promise.all(processes.reverse().map((child) => stopProcess(child)))
    await fs.rm(root, { recursive: true, force: true })
  }
})

function startProcess(name, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: workspaceRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.output = ''
  child.stdout.on('data', (chunk) => {
    child.output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    child.output += chunk.toString()
  })
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

async function getJson(url) {
  return requestJson('GET', url)
}

async function postJson(url, body) {
  return requestJson('POST', url, body)
}

async function requestJson(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(`${method} ${url} failed: ${response.status} ${JSON.stringify(payload)}`)
  return payload
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
