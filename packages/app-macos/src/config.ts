import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface AppConfig {
  apiUrl:     string
  wsUrl:      string
  webUrl:     string
  agentToken: string
  deviceId:   string
  deviceName: string
  email?:     string
}

const CONFIG_DIR  = join(homedir(), '.sync-tool')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

const DEFAULTS: AppConfig = {
  apiUrl:     'https://api-production-186a.up.railway.app',
  wsUrl:      'wss://api-production-186a.up.railway.app',
  webUrl:     'https://web-seven-peach-99.vercel.app',
  agentToken: '',
  deviceId:   '',
  deviceName: require('os').hostname(),
}

let _cache: AppConfig | null = null

export function loadConfig(): AppConfig {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
  if (!existsSync(CONFIG_FILE)) {
    saveConfig(DEFAULTS)
    return { ...DEFAULTS }
  }
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    _cache = normalizeConfig({ ...DEFAULTS, ...raw })
    return _cache!
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveConfig(cfg: AppConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
  const normalized = normalizeConfig(cfg)
  writeFileSync(CONFIG_FILE, JSON.stringify(normalized, null, 2), 'utf8')
  _cache = normalized
}

export function getConfig(): AppConfig {
  return _cache ?? loadConfig()
}

export function browserWsUrl(wsUrl: string): string {
  return wsUrl.replace(/\/agent\/?$/, '').replace(/\/$/, '')
}

export function agentWsUrl(wsUrl: string): string {
  return `${browserWsUrl(wsUrl)}/agent`
}

function normalizeConfig(cfg: AppConfig): AppConfig {
  return {
    ...cfg,
    apiUrl: cfg.apiUrl.replace(/\/$/, ''),
    wsUrl:  browserWsUrl(cfg.wsUrl),
    webUrl: cfg.webUrl.replace(/\/$/, ''),
  }
}
