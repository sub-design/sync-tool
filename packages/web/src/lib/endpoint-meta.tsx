import { HardDrive, Server, Terminal, Network, CloudUpload, Lock } from 'lucide-react'
import type { BackendType, Endpoint } from '../types'

export const TYPE_META: Record<BackendType, { label: string; icon: React.ReactNode; color: string }> = {
  local: { label: 'Local',  icon: <HardDrive  size={14} />, color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  sftp:  { label: 'SFTP',   icon: <Terminal    size={14} />, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
  ftp:   { label: 'FTP',    icon: <Terminal    size={14} />, color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300' },
  ftps:  { label: 'FTPS',   icon: <Lock        size={14} />, color: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300' },
  s3:    { label: 'S3',     icon: <CloudUpload size={14} />, color: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300' },
  smb:   { label: 'SMB',    icon: <Network     size={14} />, color: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' },
  nfs:   { label: 'NFS',    icon: <Server      size={14} />, color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
}

export function TypeBadge({ type }: { type: BackendType }) {
  const meta = TYPE_META[type]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.color}`}>
      {meta.icon} {meta.label}
    </span>
  )
}

export function endpointSummary(ep: Pick<Endpoint, 'type' | 'config'>): string {
  const { type, config } = ep
  if (type === 'local')  return config.path ?? '—'
  if (type === 's3')     return config.bucket ? `s3://${config.bucket}${config.remotePath ? `/${config.remotePath}` : ''}` : '—'
  if (type === 'smb')    return config.host ? `\\\\${config.host}\\${config.share ?? ''}` : '—'
  if (type === 'nfs')    return config.host ? `${config.host}:${config.remotePath ?? '/'}` : '—'
  return config.host ? `${config.host}:${config.port ?? ''}${config.remotePath ?? ''}` : '—'
}

export function endpointConfigRows(ep: Endpoint): Array<{ label: string; value: string }> {
  const { type, config } = ep
  const rows: Array<{ label: string; value: string }> = []

  if (type === 'local') {
    if (config.path)       rows.push({ label: 'Path', value: config.path })
    if (ep.deviceId)       rows.push({ label: 'Device ID', value: ep.deviceId })
  } else if (type === 's3') {
    if (config.bucket)     rows.push({ label: 'Bucket', value: config.bucket })
    if (config.region)     rows.push({ label: 'Region', value: config.region })
    if (config.remotePath) rows.push({ label: 'Key prefix', value: config.remotePath })
    if (config.endpoint)   rows.push({ label: 'Custom endpoint', value: config.endpoint })
    if (config.accessKeyId) rows.push({ label: 'Access key ID', value: config.accessKeyId })
  } else if (type === 'smb') {
    if (config.host)       rows.push({ label: 'Host', value: config.host })
    if (config.share)      rows.push({ label: 'Share', value: config.share })
    if (config.remotePath) rows.push({ label: 'Sub-path', value: config.remotePath })
    if (config.username)   rows.push({ label: 'Username', value: config.username })
  } else if (type === 'nfs') {
    if (config.host)       rows.push({ label: 'Host', value: config.host })
    if (config.remotePath) rows.push({ label: 'Export path', value: config.remotePath })
  } else {
    if (config.host)       rows.push({ label: 'Host', value: config.host })
    if (config.port)       rows.push({ label: 'Port', value: String(config.port) })
    if (config.remotePath) rows.push({ label: 'Remote path', value: config.remotePath })
    if (config.username)   rows.push({ label: 'Username', value: config.username })
    if (config.keyPath)    rows.push({ label: 'SSH key path', value: config.keyPath })
  }

  return rows
}
