const WebSocket = require('ws')

const relayUrl = process.env.RELAY_URL ?? 'ws://127.0.0.1:3002'
const token = process.env.RELAY_TOKEN
const timeoutMs = Number.parseInt(process.env.RELAY_SMOKE_TIMEOUT_MS ?? '8000', 10)

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const a = await connect(`smoke-a-${suffix}`)
  const b = await connect(`smoke-b-${suffix}`)

  try {
    await waitFor(() => messages(a).some((msg) => msg.type === 'relay:peer:online' && msg.deviceId === b.deviceId), 'a sees b online')
    await waitFor(() => messages(b).some((msg) => msg.type === 'relay:peer:online' && msg.deviceId === a.deviceId), 'b sees a online')

    send(a, { type: 'relay:data', to: b.deviceId, payload: Buffer.from('smoke-data', 'utf8').toString('base64') })
    await waitFor(() => messages(b).some((msg) => msg.type === 'relay:data' && msg.from === a.deviceId), 'b receives data')

    send(a, { type: 'relay:signal', to: b.deviceId, signal: { kind: 'ice', candidate: 'candidate:smoke', mid: '0' } })
    await waitFor(() => messages(b).some((msg) => msg.type === 'relay:signal'
      && msg.from === a.deviceId
      && msg.signal?.candidate === 'candidate:smoke'), 'b receives signal')

    b.close()
    await waitFor(() => messages(a).some((msg) => msg.type === 'relay:peer:offline' && msg.deviceId === b.deviceId), 'a sees b offline')

    console.log(`[relay-smoke] ok ${relayUrl}`)
  } finally {
    a.close()
    b.close()
  }
}

function connect(deviceId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl)
    ws.deviceId = deviceId
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
        platform: 'smoke',
        ...(token ? { token } : {}),
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

async function waitFor(check, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

main().catch((err) => {
  console.error(`[relay-smoke] failed: ${err.message}`)
  process.exitCode = 1
})
