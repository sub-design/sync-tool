const assert = require('node:assert/strict')
const net = require('node:net')
const path = require('node:path')
const { spawn } = require('node:child_process')
const test = require('node:test')
const WebSocket = require('ws')

const workspaceRoot = path.resolve(__dirname, '../../..')

test('relay scopes peer visibility and routing by token namespace', { timeout: 15_000 }, async () => {
  const port = await freePort()
  const relay = startProcess('relay', ['packages/relay/dist/index.js'], {
    PORT: String(port),
    RELAY_TOKENS: 'scope-a:token-a,scope-b:token-b',
  })
  try {
    await waitFor(async () => {
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      return res.ok
    }, 'relay health')

    const a = await connectRelay(port, 'a', 'token-a')
    const b = await connectRelay(port, 'b', 'token-a')
    const c = await connectRelay(port, 'c', 'token-b')

    await waitFor(() => messages(a).some((msg) => msg.type === 'relay:peer:online' && msg.deviceId === 'b'), 'a sees b')
    assert.equal(messages(a).some((msg) => msg.type === 'relay:peer:online' && msg.deviceId === 'c'), false)
    assert.equal(messages(c).some((msg) => msg.type === 'relay:peer:online' && msg.deviceId === 'a'), false)

    send(a, { type: 'relay:data', to: 'b', payload: 'hello' })
    await waitFor(() => messages(b).some((msg) => msg.type === 'relay:data' && msg.from === 'a' && msg.payload === 'hello'), 'b receives a data')

    send(a, { type: 'relay:data', to: 'c', payload: 'blocked' })
    await sleep(300)
    assert.equal(messages(c).some((msg) => msg.type === 'relay:data' && msg.payload === 'blocked'), false)

    a.close()
    b.close()
    c.close()
  } finally {
    await stopProcess(relay)
  }
})

function connectRelay(port, deviceId, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.seen = []
    ws.on('message', (raw) => {
      try { ws.seen.push(JSON.parse(raw.toString())) } catch {}
    })
    ws.once('open', () => {
      send(ws, {
        type: 'relay:register',
        deviceId,
        name: deviceId,
        hostname: deviceId,
        platform: 'test',
        token,
      })
    })
    ws.once('error', reject)
    waitFor(() => messages(ws).some((msg) => msg.type === 'relay:registered'), `register ${deviceId}`)
      .then(() => resolve(ws), reject)
  })
}

function messages(ws) {
  return ws.seen ?? []
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg))
}

function startProcess(name, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: workspaceRoot,
    env: { ...process.env, ...env },
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
