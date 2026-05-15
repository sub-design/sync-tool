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
    const registeredHealth = await getJson(`http://127.0.0.1:${port}/health`)
    assert.equal(registeredHealth.ok, true)
    assert.equal(registeredHealth.connections.registered, 3)
    assert.equal(registeredHealth.scopes.some((scope) => scope.scope === 'scope-a' && scope.devices === 2), true)
    assert.equal(registeredHealth.scopes.some((scope) => scope.scope === 'scope-b' && scope.devices === 1), true)

    assert.equal(messages(a).some((msg) => msg.type === 'relay:peer:online' && msg.deviceId === 'c'), false)
    assert.equal(messages(c).some((msg) => msg.type === 'relay:peer:online' && msg.deviceId === 'a'), false)

    send(a, { type: 'relay:data', to: 'b', payload: 'hello' })
    await waitFor(() => messages(b).some((msg) => msg.type === 'relay:data' && msg.from === 'a' && msg.payload === 'hello'), 'b receives a data')

    send(a, { type: 'relay:signal', to: 'b', signal: { kind: 'ice', candidate: 'candidate:1', mid: '0' } })
    await waitFor(() => messages(b).some((msg) => msg.type === 'relay:signal'
      && msg.from === 'a'
      && msg.signal?.kind === 'ice'
      && msg.signal?.candidate === 'candidate:1'), 'b receives a signal')

    send(a, { type: 'relay:data', to: 'c', payload: 'blocked' })
    await sleep(300)
    assert.equal(messages(c).some((msg) => msg.type === 'relay:data' && msg.payload === 'blocked'), false)
    const routedHealth = await getJson(`http://127.0.0.1:${port}/health`)
    assert.equal(routedHealth.metrics.dataMessagesRelayed, 1)
    assert.equal(routedHealth.metrics.signalMessagesRelayed, 1)
    assert.equal(routedHealth.metrics.droppedMessages, 1)
    const metrics = await getText(`http://127.0.0.1:${port}/metrics`)
    assert.match(metrics, /sync_tool_relay_connections\{state="registered"\} 3/)
    assert.match(metrics, /sync_tool_relay_messages_total\{type="data"\} 1/)
    assert.match(metrics, /sync_tool_relay_messages_total\{type="signal"\} 1/)
    assert.match(metrics, /sync_tool_relay_dropped_messages_total 1/)
    assert.match(metrics, /sync_tool_relay_scope_devices\{scope="scope-a"\} 2/)

    b.close()
    await waitFor(() => messages(a).some((msg) => msg.type === 'relay:peer:offline' && msg.deviceId === 'b'), 'a sees b offline')

    a.close()
    c.close()
  } finally {
    await stopProcess(relay)
  }
})

test('relay rejects unauthorized registrations', { timeout: 15_000 }, async () => {
  const port = await freePort()
  const relay = startProcess('relay', ['packages/relay/dist/index.js'], {
    PORT: String(port),
    RELAY_TOKENS: 'scope-a:token-a',
  })
  try {
    await waitFor(async () => (await getJson(`http://127.0.0.1:${port}/health`)).ok === true, 'relay health')

    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.seen = []
    ws.on('message', (raw) => {
      try { ws.seen.push(JSON.parse(raw.toString())) } catch {}
    })
    await new Promise((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })

    send(ws, {
      type: 'relay:register',
      deviceId: 'unauthorized',
      name: 'unauthorized',
      hostname: 'unauthorized',
      platform: 'test',
      token: 'wrong-token',
    })

    const close = await waitForClose(ws)
    assert.equal(close.code, 1008)
    assert.equal(messages(ws).some((msg) => msg.type === 'relay:error' && msg.message === 'Unauthorized'), true)
    const health = await getJson(`http://127.0.0.1:${port}/health`)
    assert.equal(health.metrics.authFailures, 1)
  } finally {
    await stopProcess(relay)
  }
})

test('relay rejects malformed protocol messages', { timeout: 15_000 }, async () => {
  const port = await freePort()
  const relay = startProcess('relay', ['packages/relay/dist/index.js'], {
    PORT: String(port),
    RELAY_TOKENS: 'scope-a:token-a',
  })
  try {
    await waitFor(async () => (await getJson(`http://127.0.0.1:${port}/health`)).ok === true, 'relay health')

    const malformed = new WebSocket(`ws://127.0.0.1:${port}`)
    malformed.seen = []
    malformed.on('message', (raw) => {
      try { malformed.seen.push(JSON.parse(raw.toString())) } catch {}
    })
    await new Promise((resolve, reject) => {
      malformed.once('open', resolve)
      malformed.once('error', reject)
    })
    malformed.send('{not-json')
    let close = await waitForClose(malformed)
    assert.equal(close.code, 1008)
    assert.equal(messages(malformed).some((msg) => msg.type === 'relay:error' && msg.message.includes('malformed JSON')), true)

    const invalidSignal = await connectRelay(port, 'invalid-signal', 'token-a')
    send(invalidSignal, { type: 'relay:signal', to: 'target', signal: { kind: 'offer' } })
    close = await waitForClose(invalidSignal)
    assert.equal(close.code, 1008)
    assert.equal(messages(invalidSignal).some((msg) => msg.type === 'relay:error' && msg.message.includes('signal.sdp is required')), true)

    const health = await getJson(`http://127.0.0.1:${port}/health`)
    assert.equal(health.metrics.invalidMessages, 2)
    const metrics = await getText(`http://127.0.0.1:${port}/metrics`)
    assert.match(metrics, /sync_tool_relay_invalid_messages_total 2/)
  } finally {
    await stopProcess(relay)
  }
})

test('relay rejects oversized data payloads', { timeout: 15_000 }, async () => {
  const port = await freePort()
  const relay = startProcess('relay', ['packages/relay/dist/index.js'], {
    PORT: String(port),
    RELAY_TOKENS: 'scope-a:token-a',
    RELAY_MAX_PAYLOAD_BYTES: '8',
  })
  try {
    await waitFor(async () => (await getJson(`http://127.0.0.1:${port}/health`)).ok === true, 'relay health')

    const a = await connectRelay(port, 'a', 'token-a')
    const b = await connectRelay(port, 'b', 'token-a')

    send(a, { type: 'relay:data', to: 'b', payload: 'this-payload-is-too-large' })

    const close = await waitForClose(a)
    assert.equal(close.code, 1009)
    assert.equal(messages(a).some((msg) => msg.type === 'relay:error' && msg.message === 'Relay payload too large'), true)
    assert.equal(messages(b).some((msg) => msg.type === 'relay:data' && msg.payload === 'this-payload-is-too-large'), false)
    const health = await getJson(`http://127.0.0.1:${port}/health`)
    assert.equal(health.metrics.oversizedMessages, 1)

    b.close()
  } finally {
    await stopProcess(relay)
  }
})

test('relay rate limits noisy clients', { timeout: 15_000 }, async () => {
  const port = await freePort()
  const relay = startProcess('relay', ['packages/relay/dist/index.js'], {
    PORT: String(port),
    RELAY_TOKENS: 'scope-a:token-a',
    RELAY_RATE_LIMIT_WINDOW_MS: '60000',
    RELAY_RATE_LIMIT_MAX_MESSAGES: '2',
  })
  try {
    await waitFor(async () => (await getJson(`http://127.0.0.1:${port}/health`)).ok === true, 'relay health')

    const a = await connectRelay(port, 'a', 'token-a')
    const b = await connectRelay(port, 'b', 'token-a')

    send(a, { type: 'relay:data', to: 'b', payload: 'first' })
    send(a, { type: 'relay:data', to: 'b', payload: 'second' })
    send(a, { type: 'relay:data', to: 'b', payload: 'third' })

    const close = await waitForClose(a)
    assert.equal(close.code, 1008)
    assert.equal(messages(a).some((msg) => msg.type === 'relay:error' && msg.message === 'Rate limit exceeded'), true)
    const health = await getJson(`http://127.0.0.1:${port}/health`)
    assert.equal(health.metrics.rateLimitedClients, 1)

    b.close()
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

function waitForClose(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve({ code: ws.closeCode, reason: ws.closeReason?.toString?.() ?? '' })
      return
    }
    ws.once('close', (code, reason) => {
      resolve({ code, reason: reason.toString() })
    })
  })
}

async function getJson(url) {
  const res = await fetch(url)
  assert.equal(res.ok, true)
  return res.json()
}

async function getText(url) {
  const res = await fetch(url)
  assert.equal(res.ok, true)
  return res.text()
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
