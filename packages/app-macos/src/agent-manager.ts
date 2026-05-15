import { ChildProcess, spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { agentWsUrl, getConfig } from './config'

export type AgentStatus = 'stopped' | 'starting' | 'running' | 'error'

let agentProcess: ChildProcess | null = null
let _status: AgentStatus = 'stopped'
let _onStatusChange: ((s: AgentStatus) => void) | null = null
let _restartTimer: ReturnType<typeof setTimeout> | null = null
let _restartDelay = 2_000
let _intentionallyStopped = false

export function onAgentStatusChange(cb: (s: AgentStatus) => void): void {
  _onStatusChange = cb
}

function setStatus(s: AgentStatus) {
  _status = s
  _onStatusChange?.(s)
}

export function agentStatus(): AgentStatus {
  return _status
}

interface AgentCommand { cmd: string; args: string[]; extraEnv?: Record<string, string> }

function resolveAgentCommand(): AgentCommand {
  // 1. Bundled: Resources/agent/index.js — run using Electron's built-in Node.js runtime
  //    (ELECTRON_RUN_AS_NODE=1 makes the Electron binary behave as plain node)
  //    app.getAppPath() = .../Contents/Resources/app.asar
  //    so '..' gives us .../Contents/Resources/
  const bundledJs = join(app.getAppPath(), '..', 'agent', 'index.js')
  if (existsSync(bundledJs)) {
    return {
      cmd: process.execPath,
      args: [bundledJs],
      extraEnv: { ELECTRON_RUN_AS_NODE: '1' },
    }
  }

  // 2. Development: tsx/ts-node from workspace root node_modules
  // __dirname = packages/app-macos/dist  →  ../../.. = workspace root
  const workspaceRoot  = join(__dirname, '..', '..', '..')
  const agentIndex     = join(workspaceRoot, 'packages', 'agent', 'src', 'index.ts')
  const tsxBin         = join(workspaceRoot, 'node_modules', '.bin', 'tsx')
  const tsNodeBin      = join(workspaceRoot, 'packages', 'agent', 'node_modules', '.bin', 'ts-node')

  if (existsSync(agentIndex)) {
    if (existsSync(tsxBin))    return { cmd: tsxBin,    args: [agentIndex] }
    if (existsSync(tsNodeBin)) return { cmd: tsNodeBin, args: ['--transpile-only', agentIndex] }
    return { cmd: 'pnpm', args: ['--filter', 'agent', 'exec', 'ts-node', agentIndex] }
  }

  throw new Error('Agent bundle not found. Run: pnpm --filter agent bundle')
}

export function startAgent(): void {
  _intentionallyStopped = false
  if (_restartTimer) {
    clearTimeout(_restartTimer)
    _restartTimer = null
  }
  _spawnAgent()
}

function _spawnAgent(): void {
  if (agentProcess) return
  const cfg = getConfig()
  if (!cfg.agentToken) return

  setStatus('starting')
  const { cmd, args, extraEnv } = resolveAgentCommand()

  agentProcess = spawn(cmd, args, {
    env: {
      ...process.env,
      ...extraEnv,
      API_URL:      agentWsUrl(cfg.wsUrl),
      AGENT_TOKEN:  cfg.agentToken,
      DEVICE_ID:    cfg.deviceId,
    },
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const startedAt = Date.now()

  agentProcess.stdout?.on('data', (d: Buffer) => {
    const line = d.toString().trim()
    if (line.includes('Registered')) {
      _restartDelay = 2_000
      setStatus('running')
    }
    console.log('[agent]', line)
  })

  agentProcess.stderr?.on('data', (d: Buffer) => {
    console.error('[agent:err]', d.toString().trim())
  })

  agentProcess.on('spawn', () => {
    setTimeout(() => {
      if (_status === 'starting') setStatus('running')
    }, 5_000)
  })

  agentProcess.on('exit', (code) => {
    agentProcess = null
    if (_intentionallyStopped) {
      setStatus('stopped')
      return
    }

    const ranFor = Date.now() - startedAt
    if (ranFor > 30_000) _restartDelay = 2_000

    setStatus('error')
    console.log(`[agent] Crashed (code ${code}). Restarting in ${_restartDelay / 1000}s…`)
    _restartTimer = setTimeout(() => {
      _restartTimer = null
      if (!_intentionallyStopped) _spawnAgent()
    }, _restartDelay)

    _restartDelay = Math.min(_restartDelay * 2, 30_000)
  })
}

export function stopAgent(): void {
  _intentionallyStopped = true
  if (_restartTimer) {
    clearTimeout(_restartTimer)
    _restartTimer = null
  }
  if (!agentProcess) return
  agentProcess.kill('SIGTERM')
  agentProcess = null
  setStatus('stopped')
}

export function restartAgent(): void {
  stopAgent()
  _intentionallyStopped = false
  setTimeout(_spawnAgent, 500)
}

// Clean up on app quit
app.on('before-quit', () => stopAgent())
