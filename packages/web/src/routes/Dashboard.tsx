import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Plus, Play, StopCircle, MoreHorizontal, ChevronRight,
  CheckCircle2, XCircle, Clock, Loader2, ArrowRight, ArrowLeft, ArrowLeftRight,
  Activity, HardDrive, Files,
} from 'lucide-react'
import Shell from '@/components/Shell'
import JobForm from '@/components/JobForm'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { subscribe } from '@/lib/ws'
import { useWsStore } from '@/lib/ws'
import { formatRelative } from '@/lib/format'
import { describeCron } from '@/lib/cron'
import * as api from '@/lib/api'
import type { Job, JobStatus, AuditEntry } from '@/types'

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (n === 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(n) / Math.log(1024))
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function pct(a: number, b: number): string {
  if (b === 0) return '—'
  return `${Math.round((a / b) * 100)}%`
}

// ── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, sub, color = '',
}: {
  icon: React.ElementType; label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-1.5">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        <Icon size={13} />
        {label}
      </div>
      <p className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

// ── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: JobStatus }) {
  switch (status) {
    case 'idle':      return <Badge variant="secondary">idle</Badge>
    case 'queued':    return <Badge variant="outline" className="border-blue-300 text-blue-600">queued</Badge>
    case 'running':   return <Badge variant="outline" className="border-amber-300 text-amber-600 gap-1"><Loader2 className="animate-spin size-3" />syncing</Badge>
    case 'completed': return <Badge variant="outline" className="border-green-300 text-green-600 gap-1"><CheckCircle2 className="size-3" />done</Badge>
    case 'cancelled': return <Badge variant="outline" className="border-slate-300 text-slate-500">cancelled</Badge>
    case 'error':     return <Badge variant="destructive" className="gap-1"><XCircle className="size-3" />error</Badge>
  }
}

const DIRECTION_ICON: Record<string, React.ElementType> = {
  ltr:   ArrowRight,
  rtl:   ArrowLeft,
  bidir: ArrowLeftRight,
}

// ── Job row ──────────────────────────────────────────────────────────────────

function JobRow({ job }: { job: Job }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const jobProgress = useWsStore(s => s.jobProgress)
  const progress = jobProgress.get(job.id)
  const isActive = job.status === 'running' || job.status === 'queued'
  const DirIcon = DIRECTION_ICON[job.direction] ?? ArrowRight

  async function handleRun(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await api.runJob(job.id)
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    } catch {
      toast.error('Failed to start job')
    }
  }

  async function handleCancel(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await api.cancelJob(job.id)
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    } catch {
      toast.error('Failed to cancel job')
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Delete job "${job.name}"?`)) return
    try {
      await api.deleteJob(job.id)
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      toast.success('Job deleted')
    } catch {
      toast.error('Failed to delete job')
    }
  }

  return (
    <tr
      className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
      onClick={() => navigate(`/jobs/${job.id}`)}
    >
      <td className="py-3 pl-4 pr-2">
        <div className="flex items-center gap-2">
          <DirIcon className="size-3.5 text-muted-foreground flex-shrink-0" />
          <span className="font-medium text-sm">{job.name}</span>
          {job.schedule && (
            <Badge variant="secondary" className="font-normal text-xs gap-1 hidden sm:inline-flex">
              <Clock className="size-3" />{describeCron(job.schedule)}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground font-mono truncate max-w-xs mt-0.5">
          {job.source} → {job.destination}
        </p>
        {isActive && progress && (
          <div className="mt-1.5 space-y-0.5">
            <Progress value={progress.filesProcessed ?? 0} max={progress.filesTotal ?? 100} className="h-1" />
            {progress.currentFile && (
              <p className="text-xs text-muted-foreground truncate">{progress.currentFile}</p>
            )}
          </div>
        )}
      </td>
      <td className="py-3 px-2 whitespace-nowrap">
        <StatusBadge status={job.status} />
      </td>
      <td className="py-3 px-2 text-xs text-muted-foreground whitespace-nowrap hidden md:table-cell">
        {formatRelative(job.lastRun)}
      </td>
      <td className="py-3 pl-2 pr-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-1 justify-end">
          <Button
            size="sm" variant="ghost"
            disabled={isActive}
            onClick={handleRun}
            className="h-7 w-7 p-0"
            title="Run now"
          >
            <Play className="size-3.5" />
          </Button>
          {isActive && (
            <Button
              size="sm" variant="ghost"
              onClick={handleCancel}
              className="h-7 w-7 p-0"
              title="Cancel"
            >
              <StopCircle className="size-3.5" />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigate(`/jobs/${job.id}`)}>
                View details
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={handleDelete}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </td>
    </tr>
  )
}

// ── Activity row ─────────────────────────────────────────────────────────────

function ActivityRow({ entry }: { entry: AuditEntry }) {
  const label = entry.action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const isError = entry.action.includes('error') || entry.action.includes('fail')
  const isSuccess = entry.action.includes('complet') || entry.action.includes('success')
  const Icon = isError ? XCircle : isSuccess ? CheckCircle2 : Activity

  return (
    <div className="flex items-start gap-3 py-2.5 border-b last:border-0">
      <Icon className={`size-4 mt-0.5 flex-shrink-0 ${
        isError ? 'text-destructive' : isSuccess ? 'text-green-600' : 'text-muted-foreground'
      }`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{label}</p>
        {entry.targetId && (
          <p className="text-xs text-muted-foreground truncate">#{entry.targetId}</p>
        )}
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">{formatRelative(entry.createdAt)}</span>
    </div>
  )
}

// ── Status filter tabs ───────────────────────────────────────────────────────

type StatusFilter = 'all' | 'running' | 'error' | 'completed'

const FILTER_OPTIONS: { id: StatusFilter; label: string }[] = [
  { id: 'all',       label: 'All' },
  { id: 'running',   label: 'Running' },
  { id: 'error',     label: 'Failed' },
  { id: 'completed', label: 'Done' },
]

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs'],
    queryFn: api.listJobs,
  })

  const { data: analytics } = useQuery({
    queryKey: ['analytics', 7],
    queryFn: () => api.getAnalytics(7),
    staleTime: 2 * 60_000,
  })

  const { data: auditEntries = [] } = useQuery({
    queryKey: ['audit-recent'],
    queryFn: () => api.listAudit(8),
    staleTime: 60_000,
  })

  useEffect(() => {
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['jobs'] })
    const unsubs = [
      subscribe('job:status',    invalidate),
      subscribe('job:complete',  invalidate),
      subscribe('job:cancelled', invalidate),
      subscribe('job:error',     invalidate),
    ]
    return () => unsubs.forEach(fn => fn())
  }, [queryClient])

  const filteredJobs = useMemo(() => {
    if (statusFilter === 'all') return jobs
    if (statusFilter === 'running') return jobs.filter(j => j.status === 'running' || j.status === 'queued')
    return jobs.filter(j => j.status === statusFilter)
  }, [jobs, statusFilter])

  const counts = useMemo(() => ({
    all:       jobs.length,
    running:   jobs.filter(j => j.status === 'running' || j.status === 'queued').length,
    error:     jobs.filter(j => j.status === 'error').length,
    completed: jobs.filter(j => j.status === 'completed').length,
  }), [jobs])

  const summary = analytics?.summary

  return (
    <Shell>
      <div className="space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={Activity}
            label="Total runs (7d)"
            value={summary ? fmtNum(summary.totalRuns) : '—'}
            sub={`${summary?.successfulRuns ?? 0} successful`}
          />
          <StatCard
            icon={CheckCircle2}
            label="Success rate"
            value={summary ? pct(summary.successfulRuns, summary.totalRuns) : '—'}
            color={(summary?.errorRuns ?? 0) > 0 ? 'text-amber-600' : 'text-green-600'}
          />
          <StatCard
            icon={HardDrive}
            label="Data moved (7d)"
            value={summary ? fmtBytes(summary.totalBytesTransferred) : '—'}
          />
          <StatCard
            icon={Files}
            label="Files synced (7d)"
            value={summary ? fmtNum(summary.totalFilesCopied) : '—'}
            sub={summary?.totalFilesDeleted ? `${fmtNum(summary.totalFilesDeleted)} deleted` : undefined}
          />
        </div>

        {/* Jobs table */}
        <div className="border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1">
              {FILTER_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setStatusFilter(opt.id)}
                  className={[
                    'px-2.5 py-1 text-sm rounded-md transition-colors',
                    statusFilter === opt.id
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                  ].join(' ')}
                >
                  {opt.label}
                  <span className="ml-1.5 text-xs opacity-70">{counts[opt.id]}</span>
                </button>
              ))}
            </div>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" />
              New job
            </Button>
          </div>

          {filteredJobs.length === 0 ? (
            <div className="text-center py-16 text-sm text-muted-foreground">
              {statusFilter === 'all'
                ? 'No jobs yet. Create your first sync job.'
                : `No ${statusFilter} jobs.`
              }
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                    <th className="text-left py-2 pl-4 pr-2 font-medium">Job</th>
                    <th className="text-left py-2 px-2 font-medium">Status</th>
                    <th className="text-left py-2 px-2 font-medium hidden md:table-cell">Last run</th>
                    <th className="py-2 pl-2 pr-4" />
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map(job => (
                    <JobRow key={job.id} job={job} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent activity */}
        {auditEntries.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h2 className="text-sm font-medium">Recent activity</h2>
              <a href="/audit" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                View all <ChevronRight className="size-3.5" />
              </a>
            </div>
            <div className="px-4">
              {auditEntries.map(entry => (
                <ActivityRow key={entry.id} entry={entry} />
              ))}
            </div>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-5xl">
          <DialogTitle>New job</DialogTitle>
          <JobForm
            onSuccess={() => {
              setDialogOpen(false)
              queryClient.invalidateQueries({ queryKey: ['jobs'] })
              toast.success('Job created')
            }}
          />
        </DialogContent>
      </Dialog>
    </Shell>
  )
}
