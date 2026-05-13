import type { BackendType, EndpointConfig } from '../types'

const defaultPorts: Record<BackendType, string> = {
  local: '',
  sftp: '22',
  ftp: '21',
  ftps: '990',
  smb: '',
  nfs: '',
}

export function createEmptyEndpoint(raw = ''): EndpointConfig {
  return {
    type: 'local',
    localPath: raw,
    host: '',
    port: '',
    username: '',
    password: '',
    remotePath: '',
    share: '',
  }
}

export function buildBackendUrl(cfg: EndpointConfig): string {
  if (cfg.type === 'local') return cfg.localPath

  const portPart = cfg.port && cfg.port !== defaultPorts[cfg.type]
    ? `:${cfg.port}`
    : ''
  // TODO Phase 5 - move credentials to macOS Keychain.
  const credsPart = cfg.username
    ? `${encodeURIComponent(cfg.username)}:${encodeURIComponent(cfg.password)}@`
    : ''

  if (cfg.type === 'smb') {
    const sharePart = cfg.share ? `/${cfg.share.replace(/^\/+|\/+$/g, '')}` : ''
    const subPart = cfg.remotePath ? `/${cfg.remotePath.replace(/^\/+/, '')}` : ''
    return `smb://${credsPart}${cfg.host}${sharePart}${subPart}`
  }

  if (cfg.type === 'nfs') {
    const exportPart = cfg.remotePath.startsWith('/') ? cfg.remotePath : `/${cfg.remotePath}`
    return `nfs://${cfg.host}${exportPart}`
  }

  const pathPart = cfg.remotePath.startsWith('/')
    ? cfg.remotePath
    : `/${cfg.remotePath}`
  return `${cfg.type}://${credsPart}${cfg.host}${portPart}${pathPart}`
}

export function parseBackendUrl(raw: string): EndpointConfig {
  const empty = createEmptyEndpoint(raw)
  if (!raw) return empty

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ...empty, localPath: raw }
  }

  const scheme = url.protocol.replace(':', '')
  const base = {
    host: url.hostname,
    port: url.port,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  }

  if (scheme === 'smb' || scheme === 'cifs') {
    const parts = url.pathname.split('/').filter(Boolean)
    return {
      ...empty,
      ...base,
      type: 'smb',
      share: parts[0] ?? '',
      remotePath: parts.slice(1).join('/'),
    }
  }

  if (scheme === 'nfs') {
    return {
      ...empty,
      ...base,
      type: 'nfs',
      remotePath: url.pathname,
    }
  }

  if (scheme === 'sftp' || scheme === 'ftp' || scheme === 'ftps') {
    return {
      ...empty,
      ...base,
      type: scheme,
      port: url.port || defaultPorts[scheme],
      remotePath: url.pathname,
    }
  }

  return empty
}

export function maskBackendPassword(url: string): string {
  return url.replace(/:([^:@/]+)@/, ':***@')
}

export function validateEndpoint(val: string): boolean {
  if (!val) return false
  const cfg = parseBackendUrl(val)
  if (cfg.type === 'local') return cfg.localPath.length > 0
  if (!cfg.host) return false
  if ((cfg.type === 'sftp' || cfg.type === 'ftp' || cfg.type === 'ftps') && !cfg.remotePath) return false
  if (cfg.type === 'smb' && !cfg.share) return false
  return true
}
