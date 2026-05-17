import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  Info,
  RotateCcw,
  XCircle,
} from 'lucide-react'
import Shell from '@/components/Shell'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatAbsolute, formatRelative, formatDuration, formatBytes } from '@/lib/format'
import type { SyncLogEntry } from '@/components/SyncLogTable'
import FileTree from '@/components/FileTree'
import * as api from '@/lib/api'

// ── Log helpers (same pattern as JobDetail Logs tab) ─────────────────────────

type LogLevel = 'INFO' | 'WARNING' | 'ERROR'
interface LogLine { ts: number; level: LogLevel; message: string }

function parseErrors(raw: string): string[] {
  try { return JSON.parse(raw) ?? [] } catch { return [] }
}

function buildLogs(entry: SyncLogEntry): LogLine[] {
  const lines: LogLine[] = []
  lines.push({ ts: entry.started_at, level: 'INFO', message: 'Sync started' })

  for (const msg of parseErrors(entry.errors)) {
    lines.push({ ts: entry.started_at, level: 'ERROR', message: msg })
  }
  if (entry.error_message) {
    lines.push({ ts: entry.ended_at ?? entry.started_at, level: 'ERROR', message: entry.error_message })
  }

  if (entry.ended_at) {
    const level: LogLevel = entry.status === 'error' ? 'ERROR' : entry.files_errored > 0 ? 'WARNING' : 'INFO'
    lines.push({
      ts: entry.ended_at,
      level,
      message: `Sync ${entry.status}: ${entry.files_copied} copied, ${entry.files_deleted} deleted, ${entry.files_errored} errors — ${formatBytes(entry.bytes_transferred)}`,
    })
  }

  return lines.sort((a, b) => a.ts - b.ts)
}

function fmtLogTs(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const LEVEL_COLOR: Record<LogLevel, string> = {
  INFO:    'text-blue-400',
  WARNING: 'text-orange-400',
  ERROR:   'text-red-400',
}

// ── sub-components ────────────────────────────────────────────────────────────

function StatRow({ label, value, highlight }: { label: string; value: string | number; highlight?: 'error' | 'warn' }) {
  const cls = highlight === 'error' ? 'text-destructive' : highlight === 'warn' ? 'text-amber-600' : 'text-foreground'
  return (
    <div className="grid gap-4 py-1 text-sm" style={{ gridTemplateColumns: '220px 1fr' }}>
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className={`tabular-nums ${cls}`}>{value}</dd>
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function RunDetail() {
  const { jobId, runId } = useParams<{ jobId: string; runId: string }>()
  const navigate = useNavigate()
  const [warningsOpen, setWarningsOpen] = useState(false)
  const [logFilter, setLogFilter] = useState<'all' | 'errors'>('all')

  const { data: job } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.getJob(jobId!),
    enabled: !!jobId,
  })

  const { data: logData } = useQuery<SyncLogEntry[]>({
    queryKey: ['log', jobId],
    queryFn: () => api.getJobLog(jobId!, 500) as Promise<SyncLogEntry[]>,
    enabled: !!jobId,
  })

  const entry = logData?.find(e => e.id === runId)

  const { data: runFiles, isLoading: runFilesLoading } = useQuery({
    queryKey: ['run-files', runId],
    queryFn: () => api.getRunFiles(runId!),
    enabled: !!runId && !!entry,
  })

  if (!entry && logData) {
    return (
      <Shell>
        <div className="py-24 text-center text-sm text-muted-foreground">
          Run not found.{' '}
          <button className="underline" onClick={() => navigate(`/jobs/${jobId}`)}>Back to job</button>
        </div>
      </Shell>
    )
  }

  if (!entry) {
    return (
      <Shell>
        <div className="py-24 text-center text-sm text-muted-foreground">Loading…</div>
      </Shell>
    )
  }

  const duration   = entry.ended_at ? entry.ended_at - entry.started_at : null
  const isRollback = entry.is_rollback === true
  const fileErrors = parseErrors(entry.errors)
  const allErrors  = [...(entry.error_message ? [entry.error_message] : []), ...fileErrors]

  const canRollback  = !isRollback && entry.rollback_status === 'available'
  const isExpired    = entry.rollback_status === 'expired'
  const wasRolledBack = entry.rollback_status === 'used'

  const statusMeta = (() => {
    if (entry.status === 'cancelled') return { icon: <Ban size={16} className="text-muted-foreground" />, text: 'Cancelled', color: 'text-muted-foreground' }
    if (entry.status === 'error') return { icon: <XCircle size={16} className="text-destructive" />, text: 'Failed', color: 'text-destructive' }
    if (entry.files_errored > 0) return { icon: <AlertTriangle size={16} className="text-amber-500" />, text: 'Completed with errors', color: 'text-amber-600' }
    return { icon: <CheckCircle2 size={16} className="text-green-600" />, text: 'Completed', color: 'text-green-700' }
  })()

  const allLogs = buildLogs(entry)
  const logs    = logFilter === 'errors' ? allLogs.filter(l => l.level === 'ERROR') : allLogs

  const runLabel = isRollback
    ? `Rollback · ${formatAbsolute(entry.started_at)}`
    : `Run · ${formatAbsolute(entry.started_at)}`

  return (
    <Shell>
      <div className="space-y-6">
        {/* Breadcrumb */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <button onClick={() => navigate('/')}>Jobs</button>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <button onClick={() => navigate(`/jobs/${jobId}`)}>{job?.name ?? '…'}</button>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{runLabel}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Header */}
        <div className="space-y-3">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
            <div>
              <h1 className="text-xl font-semibold mb-2">{runLabel}</h1>
              <div className={`flex items-center gap-1.5 text-sm ${statusMeta.color}`}>
                {statusMeta.icon}
                <span>{statusMeta.text}</span>
                {duration != null && (
                  <span className="text-muted-foreground ml-3">· Duration: {formatDuration(duration)}</span>
                )}
                <span className="text-muted-foreground ml-3">· Started {formatRelative(entry.started_at)}</span>
              </div>
            </div>

            <dl className="grid gap-x-5 gap-y-1.5 text-sm" style={{ gridTemplateColumns: 'auto 1fr', minWidth: 320 }}>
              <dt className="text-muted-foreground">Started at:</dt>
              <dd className="tabular-nums">{new Date(entry.started_at).toLocaleString()}</dd>
              {entry.ended_at && (
                <>
                  <dt className="text-muted-foreground">Completed at:</dt>
                  <dd className="tabular-nums">{new Date(entry.ended_at).toLocaleString()}</dd>
                </>
              )}
              {entry.transport_mode && (
                <>
                  <dt className="text-muted-foreground">Transport:</dt>
                  <dd className="capitalize">{entry.transport_mode}</dd>
                </>
              )}
            </dl>
          </div>

          {/* Errors / warnings summary line */}
          {allErrors.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <button
                type="button"
                onClick={() => setWarningsOpen(v => !v)}
                className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-foreground transition-colors hover:bg-muted"
              >
                <AlertTriangle size={14} className="text-muted-foreground" />
                Errors: {allErrors.length}
                <ChevronDown size={13} className={`transition-transform ${warningsOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>
          )}
          {warningsOpen && (
            <ul className="space-y-1.5 text-sm">
              {allErrors.map((err, i) => (
                <li key={i} className="flex gap-2 font-mono text-xs text-destructive">
                  <XCircle size={13} className="mt-0.5 shrink-0" />
                  {err}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="summary">
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="files">
              Files
              {runFiles && runFiles.length > 0 && (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums">
                  {runFiles.length.toLocaleString()}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="logs">
              Logs
              {allErrors.length > 0 && (
                <span className="ml-1.5 rounded-full bg-destructive/15 px-1.5 py-0.5 text-xs text-destructive tabular-nums">
                  {allErrors.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Summary ── */}
          <TabsContent value="summary" className="mt-4 space-y-4">
            {/* Source & destination */}
            {job && (
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <div className="border-b border-border px-5 py-3">
                    <h3 className="font-medium text-sm">Source</h3>
                    <p className="font-mono text-xs text-muted-foreground break-all mt-0.5">{job.source}</p>
                  </div>
                  <dl className="grid gap-y-2 p-5 text-sm" style={{ gridTemplateColumns: '140px 1fr' }}>
                    <dt className="text-muted-foreground">Files copied from:</dt>
                    <dd className="tabular-nums">{entry.files_copied}</dd>
                    <dt className="text-muted-foreground">Files deleted from:</dt>
                    <dd className="tabular-nums">{entry.files_deleted ?? 0}</dd>
                  </dl>
                </Card>
                <Card>
                  <div className="border-b border-border px-5 py-3">
                    <h3 className="font-medium text-sm">Destination</h3>
                    <p className="font-mono text-xs text-muted-foreground break-all mt-0.5">{job.destination}</p>
                  </div>
                  <dl className="grid gap-y-2 p-5 text-sm" style={{ gridTemplateColumns: '140px 1fr' }}>
                    <dt className="text-muted-foreground">Files received:</dt>
                    <dd className="tabular-nums">{entry.files_copied}</dd>
                    <dt className="text-muted-foreground">Files deleted:</dt>
                    <dd className="tabular-nums">{entry.files_deleted ?? 0}</dd>
                  </dl>
                </Card>
              </div>
            )}

            {/* Summary statistics */}
            <Card>
              <div className="border-b border-border px-5 py-3">
                <h3 className="font-medium">Summary Statistics</h3>
              </div>
              <dl className="p-5">
                <StatRow label="Files copied" value={entry.files_copied} />
                <StatRow label="Files deleted" value={entry.files_deleted ?? 0} />
                <StatRow label="Files skipped" value={entry.files_skipped} />
                {entry.files_errored > 0 && (
                  <StatRow label="Files errored" value={entry.files_errored} highlight="error" />
                )}
                <StatRow label="Network transferred" value={formatBytes(entry.bytes_transferred)} />
                {entry.logical_bytes > 0 && (
                  <StatRow label="Logical size" value={formatBytes(entry.logical_bytes)} />
                )}
                {duration != null && (
                  <StatRow label="Duration" value={formatDuration(duration)} />
                )}
                {duration != null && entry.bytes_transferred > 0 && (
                  <StatRow
                    label="Average speed"
                    value={`${formatBytes(Math.round(entry.bytes_transferred / (duration / 1000)))}/s`}
                  />
                )}
                {(entry.delta_files ?? 0) > 0 && (
                  <>
                    <StatRow label="Delta files" value={`${entry.delta_files} (${formatBytes(entry.delta_bytes)})`} />
                    <StatRow label="Full-copy files" value={`${entry.full_files} (${formatBytes(entry.full_bytes)})`} />
                    <StatRow
                      label="Delta efficiency"
                      value={`${Math.round(((entry.delta_files ?? 0) / ((entry.delta_files ?? 0) + (entry.full_files ?? 0))) * 100)}% delta`}
                    />
                  </>
                )}
              </dl>
            </Card>

            {/* Rollback card */}
            {!isRollback && (
              <Card>
                <div className="border-b border-border px-5 py-3">
                  <h3 className="font-medium">Rollback</h3>
                </div>
                <div className="flex items-center justify-between gap-4 p-5">
                  <div className="flex items-start gap-3">
                    {canRollback && <RotateCcw size={16} className="mt-0.5 shrink-0" />}
                    {isExpired && <XCircle size={16} className="mt-0.5 shrink-0 text-muted-foreground" />}
                    {wasRolledBack && <Clock size={16} className="mt-0.5 shrink-0 text-muted-foreground" />}
                    {(!entry.rollback_status || entry.rollback_status === 'none') && (
                      <Info size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                    )}
                    <div className="space-y-0.5">
                      <p className={`text-sm font-medium ${isExpired || wasRolledBack ? 'text-muted-foreground' : 'text-foreground'}`}>
                        {canRollback && 'Rollback available'}
                        {isExpired && 'Rollback expired'}
                        {wasRolledBack && 'Already rolled back'}
                        {(!entry.rollback_status || entry.rollback_status === 'none') && 'Rollback unavailable'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {(!entry.rollback_status || entry.rollback_status === 'none') && 'History was not enabled for this job at run time'}
                        {isExpired && 'The rollback window for this run has closed'}
                        {wasRolledBack && 'This run was already rolled back'}
                      </p>
                    </div>
                  </div>
                  {canRollback && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/jobs/${jobId}`, { state: { rollbackRunId: runId } })}
                    >
                      <RotateCcw size={14} />
                      Start Rollback
                    </Button>
                  )}
                </div>
              </Card>
            )}

            {isRollback && (
              <div className="flex items-start gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                <Info size={15} className="mt-0.5 shrink-0" />
                This is a rollback run. Rollback runs cannot themselves be rolled back.
              </div>
            )}
          </TabsContent>

          {/* ── Files ── */}
          <TabsContent value="files" className="mt-4">
            <FileTree files={runFiles ?? []} loading={runFilesLoading} />
          </TabsContent>

          {/* ── Logs ── */}
          <TabsContent value="logs" className="mt-4">
            <Card>
              <div className="flex items-center justify-between gap-3 px-5 h-12 border-b border-border">
                <div>
                  <span className="font-medium">Logs</span>
                  <span className="ml-2 text-xs text-muted-foreground">Run output and diagnostics</span>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={logFilter} onValueChange={v => setLogFilter(v as 'all' | 'errors')}>
                    <SelectTrigger className="h-8 w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All levels</SelectItem>
                      <SelectItem value="errors">Errors only</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const text = logs.map(l => `${fmtLogTs(l.ts)} ${l.level.padEnd(7)} ${l.message}`).join('\n')
                      const a = document.createElement('a')
                      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
                      a.download = `run-${runId}-logs.txt`
                      a.click()
                    }}
                  >
                    <Download size={14} />
                  </Button>
                </div>
              </div>
              <div className="rounded-b-lg bg-gray-950 p-4 font-mono text-xs text-gray-100 overflow-auto max-h-[600px]">
                {logs.length === 0 ? (
                  <p className="text-gray-500">No log entries</p>
                ) : (
                  logs.map((l, i) => (
                    <div key={i} className="grid gap-x-4" style={{ gridTemplateColumns: '72px 72px 1fr' }}>
                      <span className="text-gray-500 tabular-nums">{fmtLogTs(l.ts)}</span>
                      <span className={`tabular-nums ${LEVEL_COLOR[l.level]}`}>{l.level}</span>
                      <span className="text-gray-200 break-all">{l.message}</span>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Shell>
  )
}
