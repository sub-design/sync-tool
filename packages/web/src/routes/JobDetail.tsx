import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Ban, CheckCircle2, ChevronRight, Circle, Download,
  Loader2, MoreHorizontal, Pencil, Play, PlayCircle, RotateCcw, Square, XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Shell from '@/components/Shell'
import SyncLogTable, { type SyncLogEntry } from '@/components/SyncLogTable'
import FileTree from '@/components/FileTree'
import type { RollbackPreview } from '@/lib/api'
import JobForm from '@/components/JobForm'
import { useWsStore, subscribe } from '@/lib/ws'
import { formatRelative, formatAbsolute, formatTimeUntil, formatDuration, formatBytes } from '@/lib/format'
import { describeCron, getNextCronRun } from '@/lib/cron'
import * as api from '@/lib/api'
import type { JobDirection, JobStatus } from '../types'

const DIRECTION_LABEL: Record<JobDirection, string> = {
  ltr:   'Left → Right (backup)',
  rtl:   'Right → Left',
  bidir: 'Both ways (sync)',
}

const DELETION_LABEL: Record<string, string> = {
  backup:              'Backup deleted files',
  'backup-with-deletes': 'Backup then delete',
  mirror:              'Mirror (delete)',
}

function statusMeta(status: JobStatus) {
  switch (status) {
    case 'idle':
      return { icon: <Circle size={16} className="text-muted-foreground" />, text: 'Idle', color: 'text-muted-foreground' }
    case 'queued':
      return { icon: <Loader2 size={16} className="text-blue-500 animate-spin" />, text: 'Queued', color: 'text-blue-600' }
    case 'running':
      return { icon: <Circle size={16} className="text-primary animate-pulse" />, text: 'Running', color: 'text-foreground' }
    case 'completed':
      return { icon: <CheckCircle2 size={16} className="text-green-600" />, text: 'Completed', color: 'text-green-700' }
    case 'cancelled':
      return { icon: <Ban size={16} className="text-slate-400" />, text: 'Cancelled', color: 'text-muted-foreground' }
    case 'error':
      return { icon: <XCircle size={16} className="text-destructive" />, text: 'Failed', color: 'text-destructive' }
  }
}

// ── Logs tab helpers ─────────────────────────────────────────────────────────

type LogLevel = 'INFO' | 'WARNING' | 'ERROR'
interface LogLine { ts: number; level: LogLevel; message: string }

function parseErrors(raw: string): string[] {
  try { return JSON.parse(raw) ?? [] } catch { return [] }
}

function buildLogs(entries: SyncLogEntry[]): LogLine[] {
  const lines: LogLine[] = []
  for (const e of entries) {
    lines.push({ ts: e.started_at, level: 'INFO', message: 'Sync started' })
    for (const msg of parseErrors(e.errors)) {
      lines.push({ ts: e.started_at, level: 'ERROR', message: msg })
    }
    if (e.error_message) {
      lines.push({ ts: e.ended_at ?? e.started_at, level: 'ERROR', message: e.error_message })
    }
    if (e.ended_at) {
      const level: LogLevel = e.status === 'error' ? 'ERROR' : e.files_errored > 0 ? 'WARNING' : 'INFO'
      lines.push({
        ts: e.ended_at,
        level,
        message: `Sync ${e.status}: ${e.files_copied} copied, ${e.files_deleted} deleted, ${e.files_errored} errors — ${formatBytes(e.bytes_transferred)}`,
      })
    }
  }
  return lines.sort((a, b) => b.ts - a.ts)
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

// ─────────────────────────────────────────────────────────────────────────────

export default function JobDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const jobProgress = useWsStore(s => s.jobProgress)

  const [tab, setTab] = useState('overview')
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [rollbackEntry, setRollbackEntry] = useState<SyncLogEntry | null>(null)
  const [rollbackPreview, setRollbackPreview] = useState<RollbackPreview | null>(null)
  const [_rollbackLoading, setRollbackLoading] = useState(false)
  const [rollbackingLogId, setRollbackingLogId] = useState<string | undefined>()
  const [logFilter, setLogFilter] = useState<'all' | 'errors'>('all')

  const { data: job } = useQuery({
    queryKey: ['job', id],
    queryFn: () => api.getJob(id!),
    enabled: !!id,
  })

  const { data: logData } = useQuery<SyncLogEntry[]>({
    queryKey: ['log', id],
    queryFn: () => api.getJobLog(id!, 50) as Promise<SyncLogEntry[]>,
    enabled: !!id,
  })

  useEffect(() => {
    if (!id) return
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ['job', id] })
      queryClient.invalidateQueries({ queryKey: ['log', id] })
    }
    const unsubs = [
      subscribe('job:status',           msg => { if (msg.jobId === id) invalidate() }),
      subscribe('job:progress',         msg => { if (msg.progress.jobId === id) invalidate() }),
      subscribe('job:complete',         msg => { if (msg.result.jobId === id) invalidate() }),
      subscribe('job:cancelled',        msg => { if (msg.jobId === id) invalidate() }),
      subscribe('job:error',            msg => { if (msg.jobId === id) invalidate() }),
      subscribe('job:rollback:complete', msg => {
        if (msg.jobId === id) { setRollbackingLogId(undefined); invalidate() }
      }),
      subscribe('job:rollback:error', msg => {
        if (msg.jobId === id) { setRollbackingLogId(undefined); invalidate() }
      }),
    ]
    return () => unsubs.forEach(fn => fn())
  }, [id, queryClient])

  async function handleRun() {
    if (!id) return
    try { await api.runJob(id); queryClient.invalidateQueries({ queryKey: ['job', id] }); toast.success('Job started') }
    catch { toast.error('Failed to start job') }
  }

  async function handleCancel() {
    if (!id) return
    try { await api.cancelJob(id); queryClient.invalidateQueries({ queryKey: ['job', id] }); toast.success('Job cancelled') }
    catch { toast.error('Failed to cancel job') }
  }

  async function handleDelete() {
    if (!id) return
    try { await api.deleteJob(id); navigate('/'); toast.success('Job deleted') }
    catch { toast.error('Failed to delete job') }
  }

  async function handleRollbackRequest(entry: SyncLogEntry) {
    if (!id) return
    setRollbackLoading(true)
    try {
      const preview = await api.getRollbackPreview(id, entry.id)
      setRollbackPreview(preview); setRollbackEntry(entry)
    } catch { toast.error('Failed to load rollback preview') }
    finally { setRollbackLoading(false) }
  }

  async function handleRollbackConfirm() {
    if (!id || !rollbackEntry) return
    try { await api.triggerRollback(id, rollbackEntry.id); setRollbackingLogId(rollbackEntry.id); toast.success('Rollback started') }
    catch { toast.error('Failed to start rollback') }
    setRollbackEntry(null); setRollbackPreview(null)
  }

  const liveRunFiles = useWsStore(s => s.liveRunFiles)
  const isActive  = job?.status === 'running' || job?.status === 'queued'
  const progress  = id ? jobProgress.get(id) : undefined
  const liveFiles = id ? (liveRunFiles.get(id) ?? []) : []
  const lastEntry = logData?.[0]

  const nextRun = job?.nextRun ?? (job?.schedule ? getNextCronRun(job.schedule) ?? undefined : undefined)
  const { icon: statusIcon, text: statusText, color: statusColor } = job ? statusMeta(job.status) : { icon: null, text: '', color: '' }

  // Logs tab data
  const allLogs  = logData ? buildLogs(logData) : []
  const logs     = logFilter === 'errors' ? allLogs.filter(l => l.level === 'ERROR') : allLogs

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
              <BreadcrumbPage>{job?.name ?? '…'}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {job && (
          <>
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-semibold">{job.name}</h1>
                <div className="mt-1 text-sm text-muted-foreground">
                  <span className="font-mono">{job.source}</span>
                  <span className="mx-2">→</span>
                  <span className="font-mono">{job.destination}</span>
                </div>
                <div className={`mt-2 flex items-center gap-1.5 text-sm ${statusColor}`}>
                  {statusIcon}
                  <span>{statusText}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {job.status === 'error' ? (
                  <Button size="sm" onClick={handleRun}>
                    <RotateCcw size={14} />
                    Retry
                  </Button>
                ) : (
                  <Button size="sm" disabled={isActive} onClick={handleRun}>
                    <Play size={14} />
                    Run
                  </Button>
                )}
                {isActive && (
                  <Button size="sm" variant="outline" onClick={handleCancel}>
                    <Square size={14} />
                    Cancel
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil size={14} />
                  Edit
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline"><MoreHorizontal size={14} /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                      Delete…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Tabs */}
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
                <TabsTrigger value="logs">Logs</TabsTrigger>
              </TabsList>

              {/* ── Overview ── */}
              <TabsContent value="overview" className="space-y-4 mt-4">
                {/* Error diagnostic card */}
                {job.status === 'error' && (
                  <Card className="border-destructive/30 bg-destructive/5">
                    <div className="flex items-center gap-2.5 px-5 h-12 border-b border-destructive/20">
                      <XCircle size={16} className="text-destructive shrink-0" />
                      <h3 className="font-medium">Job cannot run</h3>
                    </div>
                    <div className="p-5 space-y-4">
                      <dl className="grid gap-2 text-sm" style={{ gridTemplateColumns: '120px 1fr' }}>
                        <dt className="text-muted-foreground">Source:</dt>
                        <dd className="font-mono break-all">{job.source}</dd>
                        <dt className="text-muted-foreground">Destination:</dt>
                        <dd className="font-mono break-all">{job.destination}</dd>
                        {job.lastError && (
                          <>
                            <dt className="text-muted-foreground">Error:</dt>
                            <dd className="text-destructive">{job.lastError}</dd>
                          </>
                        )}
                        <dt className="text-muted-foreground">Last attempt:</dt>
                        <dd>{formatRelative(job.lastRun)}</dd>
                      </dl>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleRun}>
                          <RotateCcw size={14} />
                          Retry now
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                          <Pencil size={14} />
                          Edit job
                        </Button>
                      </div>
                    </div>
                  </Card>
                )}

                {/* Live progress */}
                {job.status === 'running' && (
                  <Card className="border-l-4 border-primary">
                    <CardContent className="space-y-3 py-4">
                      <div className="flex items-center gap-2 font-medium">
                        <Loader2 className="animate-spin" size={16} />
                        Syncing…
                      </div>
                      {progress?.currentFile && (
                        <p
                          className="text-sm font-mono text-muted-foreground truncate"
                          style={{ direction: 'rtl', textAlign: 'left' }}
                          title={progress.currentFile}
                        >
                          {progress.currentFile}
                        </p>
                      )}
                      <Progress value={progress?.filesProcessed ?? 0} max={progress?.filesTotal ?? 100} />
                      <p className="text-sm text-muted-foreground">
                        {progress?.filesProcessed ?? 0} of {progress?.filesTotal ?? 0} files
                        {' · '}
                        {formatBytes(progress?.bytesTransferred ?? 0)}
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* Live file tree */}
                {job.status === 'running' && (
                  <FileTree files={liveFiles} live />
                )}

                {/* Last Run clickable card */}
                {job.status !== 'running' && (
                  <button
                    type="button"
                    onClick={() => setTab('history')}
                    className="group w-full rounded-lg border bg-card p-5 text-left shadow-sm transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    aria-label="Open sync history"
                  >
                    <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
                      <div>
                        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Last Run</div>
                        <div className="text-lg font-semibold">
                          {job.lastRun ? (
                            <span>{formatRelative(job.lastRun)}</span>
                          ) : (
                            <span className="text-muted-foreground">Never</span>
                          )}
                          {lastEntry && (
                            <span className="ml-2 text-base font-normal text-muted-foreground">
                              · {lastEntry.status === 'error' ? 'failed' : lastEntry.status === 'cancelled' ? 'cancelled' : 'completed'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-muted-foreground transition-colors group-hover:text-foreground">
                        <PlayCircle size={18} />
                        <ChevronRight size={18} />
                      </div>
                    </div>

                    {lastEntry ? (
                      <div className="grid gap-3 pt-4 text-sm text-muted-foreground md:grid-cols-2">
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          <span className="text-foreground tabular-nums">{lastEntry.files_copied} copied</span>
                          <span className="text-border">|</span>
                          <span className="text-foreground tabular-nums">{lastEntry.files_deleted} deleted</span>
                          <span className="text-border">|</span>
                          <span className="text-foreground tabular-nums">{lastEntry.files_skipped} skipped</span>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 md:justify-end">
                          {lastEntry.ended_at && (
                            <span>
                              Duration:{' '}
                              <span className="text-foreground tabular-nums">
                                {formatDuration(lastEntry.ended_at - lastEntry.started_at)}
                              </span>
                            </span>
                          )}
                          {nextRun && (
                            <>
                              <span className="text-border hidden md:inline">|</span>
                              <span>
                                Next run:{' '}
                                <span className="text-foreground tabular-nums">{formatTimeUntil(nextRun)}</span>
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="pt-4 text-sm text-muted-foreground">No runs yet</p>
                    )}
                  </button>
                )}

                {/* Schedule & Configuration card */}
                <Card>
                  <div className="flex items-center justify-between gap-4 px-5 h-12 border-b border-border">
                    <h3 className="font-medium">Schedule &amp; Configuration</h3>
                    <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
                      <Pencil size={14} />
                      Edit
                    </Button>
                  </div>
                  <dl className="grid gap-y-3 p-5 text-sm" style={{ gridTemplateColumns: '180px 1fr' }}>
                    <dt className="text-muted-foreground">Job type:</dt>
                    <dd>{DIRECTION_LABEL[job.direction]}</dd>

                    <dt className="text-muted-foreground">Source:</dt>
                    <dd className="font-mono break-all">{job.source}</dd>

                    <dt className="text-muted-foreground">Destination:</dt>
                    <dd className="font-mono break-all">{job.destination}</dd>

                    {job.schedule && (
                      <>
                        <dt className="text-muted-foreground">Schedule:</dt>
                        <dd>
                          {describeCron(job.schedule)}
                          <span className="ml-2 text-muted-foreground font-mono text-xs">({job.schedule})</span>
                        </dd>
                      </>
                    )}

                    <dt className="text-muted-foreground">Last run:</dt>
                    <dd className="tabular-nums">
                      {job.lastRun ? (
                        <>
                          {formatAbsolute(job.lastRun)}
                          <span className="ml-2 text-muted-foreground">({formatRelative(job.lastRun)})</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Never</span>
                      )}
                    </dd>

                    <dt className="text-muted-foreground">Next run:</dt>
                    <dd className="tabular-nums">
                      {nextRun ? (
                        <>
                          {formatAbsolute(nextRun)}
                          <span className="ml-2 text-muted-foreground">({formatTimeUntil(nextRun)})</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">{job.schedule ? 'Calculating…' : 'No schedule'}</span>
                      )}
                    </dd>

                    <dt className="text-muted-foreground">Status:</dt>
                    <dd>{job.status === 'idle' ? 'Paused' : job.status === 'error' ? 'Error' : 'Active'}</dd>

                    {job.transferMode && (
                      <>
                        <dt className="text-muted-foreground">Transfer mode:</dt>
                        <dd className="capitalize">{job.transferMode}</dd>
                      </>
                    )}

                    {job.deletionPolicy && (
                      <>
                        <dt className="text-muted-foreground">Deletion policy:</dt>
                        <dd>{DELETION_LABEL[job.deletionPolicy] ?? job.deletionPolicy}</dd>
                      </>
                    )}

                    {job.conflictStrategy && (
                      <>
                        <dt className="text-muted-foreground">Conflicts:</dt>
                        <dd className="capitalize">{job.conflictStrategy.replace('-', ' ')}</dd>
                      </>
                    )}

                    {job.reliability?.bandwidthLimitBps != null && (
                      <>
                        <dt className="text-muted-foreground">Bandwidth limit:</dt>
                        <dd>{formatBytes(job.reliability.bandwidthLimitBps)}/s</dd>
                      </>
                    )}
                  </dl>
                </Card>
              </TabsContent>

              {/* ── History ── */}
              <TabsContent value="history" className="mt-4">
                <SyncLogTable
                  entries={logData ?? []}
                  onRollback={handleRollbackRequest}
                  rollbackingLogId={rollbackingLogId}
                  onRowClick={entry => navigate(`/jobs/${id}/runs/${entry.id}`)}
                />
              </TabsContent>

              {/* ── Logs ── */}
              <TabsContent value="logs" className="mt-4">
                <Card>
                  <div className="flex items-center justify-between gap-3 px-5 h-12 border-b border-border">
                    <div>
                      <span className="font-medium">Logs</span>
                      <span className="ml-2 text-xs text-muted-foreground">Latest run output</span>
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
                          a.download = `job-${id}-logs.txt`
                          a.click()
                        }}
                      >
                        <Download size={14} />
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-b-lg bg-gray-950 p-4 font-mono text-xs text-gray-100 overflow-auto max-h-[500px]">
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

            {/* Edit dialog */}
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogContent className="sm:max-w-5xl">
                <DialogTitle>Edit job</DialogTitle>
                <JobForm
                  job={job}
                  onSuccess={() => { setEditOpen(false); queryClient.invalidateQueries({ queryKey: ['job', id] }) }}
                  onCancel={() => setEditOpen(false)}
                />
              </DialogContent>
            </Dialog>

            {/* Rollback confirmation */}
            <AlertDialog open={!!rollbackEntry} onOpenChange={open => { if (!open) { setRollbackEntry(null); setRollbackPreview(null) } }}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Rollback this sync run?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2 text-sm">
                      {rollbackPreview && (
                        <>
                          <p>
                            {rollbackPreview.filesToRestore.length > 0 && (
                              <span>{rollbackPreview.filesToRestore.length} file{rollbackPreview.filesToRestore.length !== 1 ? 's' : ''} will be restored. </span>
                            )}
                            {rollbackPreview.filesToDelete.length > 0 && (
                              <span>{rollbackPreview.filesToDelete.length} file{rollbackPreview.filesToDelete.length !== 1 ? 's' : ''} created by this sync will be deleted.</span>
                            )}
                          </p>
                          <p className="text-amber-600">This action cannot be undone.</p>
                        </>
                      )}
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleRollbackConfirm}>Rollback</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Delete confirmation */}
            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this job?</AlertDialogTitle>
                  <AlertDialogDescription>
                    All sync history will also be deleted. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-white hover:bg-destructive/90"
                    onClick={handleDelete}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>
    </Shell>
  )
}
