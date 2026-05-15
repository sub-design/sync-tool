import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import { app } from 'electron'
import { getConfig } from './config'

const PLIST_ID   = 'com.sync-tool.agent'
const PLIST_DIR  = join(homedir(), 'Library', 'LaunchAgents')
const PLIST_PATH = join(PLIST_DIR, `${PLIST_ID}.plist`)

export function isLaunchAgentInstalled(): boolean {
  return existsSync(PLIST_PATH)
}

export function installLaunchAgent(): void {
  const cfg = getConfig()
  const appBin = app.getPath('exe')

  if (!existsSync(PLIST_DIR)) mkdirSync(PLIST_DIR, { recursive: true })

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_ID}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${appBin}</string>
    <string>--hidden</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>AGENT_TOKEN</key>
    <string>${cfg.agentToken}</string>
    <key>DEVICE_ID</key>
    <string>${cfg.deviceId}</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>StandardOutPath</key>
  <string>${homedir()}/.sync-tool/agent.log</string>

  <key>StandardErrorPath</key>
  <string>${homedir()}/.sync-tool/agent-error.log</string>
</dict>
</plist>`

  writeFileSync(PLIST_PATH, plist, 'utf8')

  try {
    execSync(`launchctl load "${PLIST_PATH}"`)
  } catch {
    // Already loaded or launchctl unavailable — file is still written
  }
}

export function uninstallLaunchAgent(): void {
  if (!existsSync(PLIST_PATH)) return
  try {
    execSync(`launchctl unload "${PLIST_PATH}"`)
  } catch { /* ignore */ }
  unlinkSync(PLIST_PATH)
}
