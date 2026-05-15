import { Tray, Menu, MenuItem, nativeImage, shell, app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { connectionState, jobs } from './ws-client'
import { agentStatus, startAgent, stopAgent } from './agent-manager'
import { isLaunchAgentInstalled, installLaunchAgent, uninstallLaunchAgent } from './autolaunch'
import { getConfig } from './config'
import { isUpdateAvailable, getLatestVersion, openReleasePage, checkForUpdates } from './updater'

let tray: Tray | null = null
let openPreferences: (() => void) | null = null

const STATUS_ICON: Record<string, string> = {
  idle:      '○',
  queued:    '◔',
  running:   '⟳',
  completed: '✓',
  error:     '✕',
  cancelled: '–',
}

function buildIcon(variant: 'idle' | 'active' | 'error'): Electron.NativeImage {
  const name = `tray-${variant}Template`
  const iconPath = join(__dirname, '..', 'assets', `${name}.png`)
  if (existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath)
  }
  // Fallback: empty image, rely on title instead
  return nativeImage.createEmpty()
}

function buildTrayTitle(): string {
  const conn = connectionState()
  const agSt = agentStatus()
  if (conn === 'connected') {
    const running = jobs().filter((j) => j.status === 'running').length
    if (running > 0) return `⟳ ${running}`
  }
  if (conn === 'connecting' || agSt === 'starting') return '…'
  if (conn === 'disconnected') return '●'
  return ''
}

function buildContextMenu(): Menu {
  const conn  = connectionState()
  const agSt  = agentStatus()
  const cfg   = getConfig()
  const jobList = jobs()

  const items: MenuItem[] = []

  // ── Status header ──────────────────────────────────────────────────────────
  const statusLabel =
    conn === 'connected'    ? '● Connected'    :
    conn === 'connecting'   ? '◌ Connecting…'  :
                              '○ Disconnected'

  items.push(new MenuItem({ label: statusLabel, enabled: false }))
  items.push(new MenuItem({ type: 'separator' }))

  // ── Job list (max 8) ───────────────────────────────────────────────────────
  if (jobList.length === 0) {
    items.push(new MenuItem({ label: 'No jobs configured', enabled: false }))
  } else {
    for (const job of jobList.slice(0, 8)) {
      const icon = STATUS_ICON[job.status] ?? '?'
      items.push(new MenuItem({
        label: `${icon}  ${job.name}`,
        enabled: false,
      }))
    }
    if (jobList.length > 8) {
      items.push(new MenuItem({ label: `  … and ${jobList.length - 8} more`, enabled: false }))
    }
  }

  items.push(new MenuItem({ type: 'separator' }))

  // ── Dashboard link ─────────────────────────────────────────────────────────
  items.push(new MenuItem({
    label: 'Open Dashboard ↗',
    click: () => shell.openExternal(cfg.webUrl),
  }))

  items.push(new MenuItem({ type: 'separator' }))

  // ── Agent toggle ───────────────────────────────────────────────────────────
  if (agSt === 'running') {
    items.push(new MenuItem({ label: 'Agent: Running', enabled: false }))
    items.push(new MenuItem({ label: 'Stop Agent', click: stopAgent }))
  } else if (agSt === 'starting') {
    items.push(new MenuItem({ label: 'Agent: Starting…', enabled: false }))
  } else {
    items.push(new MenuItem({ label: 'Agent: Stopped', enabled: false }))
    items.push(new MenuItem({
      label: 'Start Agent',
      enabled: !!cfg.agentToken,
      click: startAgent,
    }))
  }

  items.push(new MenuItem({ type: 'separator' }))

  // ── Login item ─────────────────────────────────────────────────────────────
  const installed = isLaunchAgentInstalled()
  items.push(new MenuItem({
    label: installed ? '✓ Open at Login' : '  Open at Login',
    click: () => {
      if (installed) uninstallLaunchAgent()
      else installLaunchAgent()
      rebuild()
    },
  }))

  items.push(new MenuItem({ type: 'separator' }))

  // ── Updates ────────────────────────────────────────────────────────────────
  if (isUpdateAvailable()) {
    items.push(new MenuItem({
      label: `⬆ Update to v${getLatestVersion()}`,
      click: openReleasePage,
    }))
  } else {
    items.push(new MenuItem({
      label: 'Check for Updates',
      click: () => { checkForUpdates(); rebuild() },
    }))
  }

  items.push(new MenuItem({ type: 'separator' }))

  // ── Preferences / Quit ─────────────────────────────────────────────────────
  items.push(new MenuItem({
    label: 'Preferences…',
    accelerator: 'Cmd+,',
    click: () => openPreferences?.(),
  }))
  items.push(new MenuItem({ label: 'Quit Sync Tool', accelerator: 'Cmd+Q', click: () => app.quit() }))

  return Menu.buildFromTemplate(items)
}

export function rebuild(): void {
  if (!tray) return
  tray.setContextMenu(buildContextMenu())
  tray.setTitle(buildTrayTitle())
  const conn = connectionState()
  const variant = conn === 'connected' ? 'active' : conn === 'disconnected' ? 'idle' : 'idle'
  tray.setImage(buildIcon(variant))
}

export function createTray(onPreferences: () => void): void {
  openPreferences = onPreferences

  tray = new Tray(buildIcon('idle'))
  tray.setToolTip('Sync Tool')
  tray.setTitle(buildTrayTitle())
  tray.setContextMenu(buildContextMenu())

  // Left-click also shows menu on macOS
  tray.on('click', () => tray?.popUpContextMenu())
}
