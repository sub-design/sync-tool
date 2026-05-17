export function formatBytes(n: number): string {
  if (n === 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(n) / Math.log(1024))
  const val = n / Math.pow(1024, i)
  return `${parseFloat(val.toFixed(1))} ${units[i]}`
}

export function formatDuration(ms: number): string {
  if (ms === 0) return '—'
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

export function formatRelative(ts?: number): string {
  if (ts == null) return 'never'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString()
}

export function formatAbsolute(ts?: number): string {
  if (ts == null) return 'never'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatTimeUntil(ts?: number): string {
  if (ts == null) return 'not scheduled'
  const diffMs = ts - Date.now()
  if (diffMs <= 0) return 'due now'
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 60) return `in ${diffMins}m`
  const hours = Math.floor(diffMins / 60)
  const mins = diffMins % 60
  if (hours < 24) return mins ? `in ${hours}h ${mins}m` : `in ${hours}h`
  return `in ${Math.floor(hours / 24)}d`
}
