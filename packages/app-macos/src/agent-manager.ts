import { ChildProcess, spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { getConfig } from './config'

export type AgentStatus = 'stopped' | 'starting' | 'running' | 'error'

let agentProcess: ChildProcess | null = null
let _status: AgentStatus = 'stopped'
let _onStatusChange: ((s: AgentStatus) => void) | null = null

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
  if (agentProcess) return
  const cfg = getConfig()
  if (!cfg.agentToken) {
    setStatus('error')
    return
  }

  setStatus('starting')
  const { cmd, args, extraEnv } = resolveAgentCommand()

  agentProcess = spawn(cmd, args, {
    env: {
      ...process.env,
      ...extraEnv,
      API_URL:      `${cfg.wsUrl}/agent`,
      AGENT_TOKEN:  cfg.agentToken,
      DEVICE_ID:    cfg.deviceId,
    },
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  agentProcess.stdout?.on('data', (d: Buffer) => {
    const line = d.toString().trim()
    if (line.includes('Registered')) setStatus('running')
    console.log('[agent]', line)
  })

  agentProcess.stderr?.on('data', (d: Buffer) => {
    console.error('[agent:err]', d.toString().trim())
  })

  agentProcess.on('spawn', () => {
    // Will flip to 'running' once we see "Registered" in stdout
    setTimeout(() => {
      if (_status === 'starting') setStatus('running')
    }, 5_000)
  })

  agentProcess.on('exit', (code) => {
    agentProcess = null
    setStatus(code === 0 ? 'stopped' : 'error')
  })
}

export function stopAgent(): void {
  if (!agentProcess) return
  agentProcess.kill('SIGTERM')
  agentProcess = null
  setStatus('stopped')
}

export function restartAgent(): void {
  stopAgent()
  setTimeout(startAgent, 500)
}

// Clean up on app quit
app.on('before-quit', () => stopAgent())
