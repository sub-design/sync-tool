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
