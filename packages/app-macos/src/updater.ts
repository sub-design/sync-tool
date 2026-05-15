import { shell, Notification } from 'electron'
import { autoUpdater } from 'electron-updater'

let _updateAvailable = false
let _latestVersion = ''
let _onAvailable: (() => void) | null = null

export function isUpdateAvailable(): boolean { return _updateAvailable }
export function getLatestVersion(): string { return _latestVersion }

export function openReleasePage(): void {
  const url = _latestVersion
    ? `https://github.com/sub-design/sync-tool/releases/tag/v${_latestVersion}`
    : 'https://github.com/sub-design/sync-tool/releases/latest'
  shell.openExternal(url)
}

export function checkForUpdates(): Promise<import('electron-updater').UpdateCheckResult | null> {
  return autoUpdater.checkForUpdates()
}

export function setupAutoUpdater(onAvailable: () => void): void {
  _onAvailable = onAvailable

  // For unsigned builds: notify and let user download manually.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    _updateAvailable = true
    _latestVersion = info.version
    _onAvailable?.()

    if (Notification.isSupported()) {
      const n = new Notification({
        title: `Sync Tool ${info.version} available`,
        body:  'Click to open the download page.',
      })
      n.on('click', openReleasePage)
      n.show()
    }
  })

  // Silent on errors — update check is best-effort.
  autoUpdater.on('error', (err) => {
    console.error('[updater]', err.message)
  })

  // Check on startup after a short delay, then every 6 hours.
  setTimeout(checkForUpdates, 10_000)
  setInterval(checkForUpdates, 6 * 60 * 60 * 1000)
}
