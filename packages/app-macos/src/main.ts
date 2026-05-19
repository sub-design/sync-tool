import { app, BrowserWindow, ipcMain, nativeTheme, Notification, powerMonitor } from 'electron'
import { join } from 'path'
import { v4 as uuid } from 'uuid'
import * as http from 'http'
import * as https from 'https'
import { loadConfig, saveConfig, getConfig } from './config'
import { createTray, rebuild as rebuildTray } from './tray'
import { connect, disconnect, onStateChange, onJobNotification } from './ws-client'
import { startAgent, restartAgent, onAgentStatusChange } from './agent-manager'
import { setupAutoUpdater } from './updater'
import type { Job } from '@sync-tool/shared'

// ── Single instance ────────────────────────────────────────────────────────────

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// ── macOS: don't show in Dock ──────────────────────────────────────────────────

app.dock?.hide()

// ── HTTP helper ────────────────────────────────────────────────────────────────

function apiPost(url: string, body: unknown, token?: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const data   = JSON.stringify(body)
    const parsed = new URL(url)
    const mod    = parsed.protocol === 'https:' ? https : http
    const req    = mod.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let raw = ''
      res.on('data', (chunk: string) => { raw += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(raw)) } catch { reject(new Error('Invalid JSON response')) }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function apiGet<T>(url: string, token?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const mod    = parsed.protocol === 'https:' ? https : http
    const req    = mod.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname,
      method:   'GET',
      headers:  token ? { Authorization: `Bearer ${token}` } : {},
    }, (res) => {
      let raw = ''
      res.on('data', (chunk: string) => { raw += chunk })
      res.on('end', () => {
        if ((res.statusCode ?? 500) >= 400) {
          reject(new Error(`GET ${parsed.pathname} failed with ${res.statusCode}`))
          return
        }
        try { resolve(JSON.parse(raw) as T) } catch { reject(new Error('Invalid JSON response')) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

interface RelayConfigResponse {
  enabled?: boolean
  relayUrl?: string
  relayToken?: string
}

async function fetchManagedRelayConfig(apiUrl: string, token: string): Promise<Pick<RelayConfigResponse, 'relayUrl' | 'relayToken'>> {
  try {
    const relay = await apiGet<RelayConfigResponse>(`${apiUrl}/api/relay-config`, token)
    return {
      relayUrl:   typeof relay.relayUrl === 'string' ? relay.relayUrl : '',
      relayToken: typeof relay.relayToken === 'string' ? relay.relayToken : '',
    }
  } catch (err) {
    console.warn(`[app] Failed to fetch relay config: ${err instanceof Error ? err.message : String(err)}`)
    return {}
  }
}

async function refreshManagedRelayConfig(): Promise<boolean> {
  const cfg = getConfig()
  if (!cfg.apiUrl || !cfg.agentToken) return false

  const relay = await fetchManagedRelayConfig(cfg.apiUrl, cfg.agentToken)
  if (!relay.relayUrl || !relay.relayToken) return false
  if (relay.relayUrl === cfg.relayUrl && relay.relayToken === cfg.relayToken) return false

  saveConfig({ ...cfg, relayUrl: relay.relayUrl, relayToken: relay.relayToken })
  return true
}

let logoffJobsTriggered = false

async function triggerLogoffJobs(reason: string): Promise<void> {
  if (logoffJobsTriggered) return
  logoffJobsTriggered = true

  const cfg = getConfig()
  if (!cfg.agentToken || !cfg.apiUrl) return

  try {
    const jobs = await apiGet<Job[]>(`${cfg.apiUrl}/api/jobs`, cfg.agentToken)
    const logoffJobs = jobs.filter((job) => job.autoOptions?.onLogoff)
    await Promise.allSettled(logoffJobs.map((job) =>
      apiPost(`${cfg.apiUrl}/api/jobs/${job.id}/run`, { reason: 'logoff' }, cfg.agentToken)
    ))
    if (logoffJobs.length > 0) {
      console.log(`[app] Queued ${logoffJobs.length} logoff job(s) on ${reason}`)
    }
  } catch (err) {
    console.warn(`[app] Failed to queue logoff jobs on ${reason}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ── Preferences window ─────────────────────────────────────────────────────────

let prefsWindow: BrowserWindow | null = null

function openPreferences(): void {
  if (prefsWindow) {
    prefsWindow.focus()
    return
  }

  prefsWindow = new BrowserWindow({
    width:           460,
    height:          520,
    resizable:       false,
    minimizable:     false,
    maximizable:     false,
    fullscreenable:  false,
    title:           'Sync Tool — Preferences',
    titleBarStyle:   'hiddenInset',
    show:            false,
    webPreferences: {
      preload:              join(__dirname, 'preferences', 'preload.js'),
      contextIsolation:     true,
      nodeIntegration:      false,
      sandbox:              false,
    },
  })

  prefsWindow.loadFile(join(__dirname, 'preferences', 'index.html'))
  prefsWindow.once('ready-to-show', () => prefsWindow?.show())
  prefsWindow.on('closed', () => { prefsWindow = null })
}

// ── IPC handlers ───────────────────────────────────────────────────────────────

ipcMain.handle('config:get', () => getConfig())

ipcMain.handle('config:login', async (_event, { apiUrl, email, password, deviceName, relayUrl, relayToken }: {
  apiUrl: string; email: string; password: string; deviceName: string; relayUrl?: string; relayToken?: string
}) => {
  const loginRes = await apiPost(`${apiUrl}/api/auth/login`, { email, password })
  if (loginRes.error) throw new Error(loginRes.error as string)

  const token = loginRes.token as string
  const deviceRes = await apiPost(`${apiUrl}/api/devices`, { name: deviceName }, token)
  if (deviceRes.error) throw new Error(deviceRes.error as string)
  const deviceId = deviceRes.id as string
  const agentToken = deviceRes.token as string
  const managedRelay = await fetchManagedRelayConfig(apiUrl, agentToken)

  const cfg = getConfig()
  saveConfig({
    ...cfg,
    apiUrl,
    wsUrl:      apiUrl.replace(/^http/, 'ws'),
    agentToken,
    deviceName,
    deviceId,
    relayUrl:   relayUrl || managedRelay.relayUrl || cfg.relayUrl,
    relayToken: relayToken || managedRelay.relayToken || cfg.relayToken,
    email,
  })
  disconnect()
  connect()
  startAgent()
  rebuildTray()
  return { email }
})

ipcMain.handle('config:signout', () => {
  const cfg = getConfig()
  saveConfig({ ...cfg, agentToken: '', email: '' })
  disconnect()
  rebuildTray()
})

ipcMain.handle('config:save-device-name', (_event, deviceName: string) => {
  saveConfig({ ...getConfig(), deviceName })
  rebuildTray()
})

ipcMain.handle('config:save-network-settings', (_event, { deviceName, relayUrl, relayToken }: {
  deviceName: string; relayUrl: string; relayToken: string
}) => {
  saveConfig({ ...getConfig(), deviceName, relayUrl, relayToken })
  restartAgent()
  rebuildTray()
})

ipcMain.on('preferences:close', () => prefsWindow?.close())

// ── Theme change → rebuild tray ────────────────────────────────────────────────

nativeTheme.on('updated', rebuildTray)

app.on('before-quit', () => {
  void triggerLogoffJobs('before-quit')
})

// ── App ready ──────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  powerMonitor.on('shutdown', () => {
    void triggerLogoffJobs('shutdown')
  })

  // Ensure config exists and has a deviceId
  const cfg = loadConfig()
  if (!cfg.deviceId) {
    saveConfig({ ...cfg, deviceId: uuid() })
  }

  // Create tray
  createTray(openPreferences)

  // Subscribe to live updates → rebuild menu
  onStateChange(rebuildTray)
  onAgentStatusChange(rebuildTray)

  // macOS notifications on job completion / error
  onJobNotification((event) => {
    if (!Notification.isSupported()) return
    if (event.kind === 'complete') {
      const { result } = event
      new Notification({
        title: `Sync complete — ${event.jobName}`,
        body:  `${result.filesCopied} copied, ${result.filesSkipped} skipped${result.filesErrored ? `, ${result.filesErrored} errors` : ''}`,
      }).show()
    } else {
      new Notification({
        title: `Sync failed — ${event.jobName}`,
        body:  event.error,
      }).show()
    }
  })

  // Auto-update checks via GitHub Releases
  setupAutoUpdater(rebuildTray)

  // Connect to API
  connect()

  // Auto-start agent if token is configured
  if (getConfig().agentToken) {
    refreshManagedRelayConfig()
      .then((changed) => {
        if (changed) restartAgent()
        else startAgent()
      })
      .catch(() => startAgent())
  }

  // First run: open preferences if no token
  if (!getConfig().agentToken) {
    setTimeout(openPreferences, 500)
  }
})

// Keep app running even with no windows open
app.on('window-all-closed', () => {
  // Do nothing — we're a menu bar app
})
