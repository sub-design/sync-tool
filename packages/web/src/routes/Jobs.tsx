import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import Shell from '@/components/Shell'
import JobForm from '@/components/JobForm'
import JobsTable from '@/components/JobsTable'
import { formatBytes, formatRelative } from '@/lib/format'
import { subscribe } from '@/lib/ws'
import * as api from '@/lib/api'

type StatusFilter = 'all' | 'running' | 'error' | 'completed' | 'idle'

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all',       label: 'All' },
  { id: 'running',   label: 'Running' },
  { id: 'error',     label: 'Failed' },
  { id: 'completed', label: 'Done' },
  { id: 'idle',      label: 'Idle' },
]

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export default function Jobs() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const [dialogOpen, setDialogOpen] = useState(false)

  const initialTab = searchParams.get('tab') === 'history' ? 'history' : 'all-jobs'
  const initialStatus = (STATUS_FILTERS.find(f => f.id === searchParams.get('status'))?.id) ?? 'all'

  const [activeTab, setActiveTab] = useState(initialTab)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus)

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs'],
    queryFn: api.listJobs,
  })

  const { data: analytics } = useQuery({
    queryKey: ['analytics', 7],
    queryFn: () => api.getAnalytics(7),
    staleTime: 2 * 60_000,
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
    if (statusFilter === 'all')       return jobs
    if (statusFilter === 'running')   return jobs.filter(j => j.status === 'running' || j.status === 'queued')
    if (statusFilter === 'error')     return jobs.filter(j => j.status === 'error')
    if (statusFilter === 'completed') return jobs.filter(j => j.status === 'completed')
    if (statusFilter === 'idle')      return jobs.filter(j => j.status === 'idle')
    return jobs
  }, [jobs, statusFilter])

  const counts: Record<StatusFilter, number> = useMemo(() => ({
    all:       jobs.length,
    running:   jobs.filter(j => j.status === 'running' || j.status === 'queued').length,
    error:     jobs.filter(j => j.status === 'error').length,
    completed: jobs.filter(j => j.status === 'completed').length,
    idle:      jobs.filter(j => j.status === 'idle').length,
  }), [jobs])

  const byJob = analytics?.byJob ?? []

  return (
    <Shell>
      <div className="space-y-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <TabsList>
              <TabsTrigger value="all-jobs">All Jobs</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" />
              New job
            </Button>
          </div>

          <TabsContent value="all-jobs" className="mt-4">
            {/* Status filter chips */}
            <div className="flex items-center gap-1.5 mb-4 flex-wrap">
              {STATUS_FILTERS.map(f => {
                const isActive = statusFilter === f.id
                const hasErrors = f.id === 'error' && counts.error > 0
                return (
                  <button
                    key={f.id}
                    onClick={() => setStatusFilter(f.id)}
                    className={[
                      'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border',
                      isActive
                        ? 'bg-primary text-primary-foreground border-primary'
                        : hasErrors
                        ? 'border-destructive/40 text-destructive hover:bg-destructive/5'
                        : 'bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground',
                    ].join(' ')}
                  >
                    {f.label}
                    <span
                      className={[
                        'text-[10px] min-w-[16px] text-center px-1 py-0.5 rounded-full',
                        isActive ? 'bg-primary-foreground/20' : 'bg-muted',
                      ].join(' ')}
                    >
                      {counts[f.id]}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="border rounded-lg overflow-hidden">
              <JobsTable
                jobs={filteredJobs}
                emptyMessage={
                  statusFilter === 'all'
                    ? 'No jobs yet. Create your first sync job.'
                    : `No ${statusFilter} jobs.`
                }
              />
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                    <th className="text-left py-2.5 pl-4 pr-2 font-medium">Job</th>
                    <th className="text-left py-2.5 px-2 font-medium hidden sm:table-cell">Runs (7d)</th>
                    <th className="text-left py-2.5 px-2 font-medium">Success rate</th>
                    <th className="text-left py-2.5 px-2 font-medium hidden md:table-cell">Data (7d)</th>
                    <th className="text-left py-2.5 px-2 font-medium hidden lg:table-cell">Files (7d)</th>
                    <th className="text-left py-2.5 pl-2 pr-4 font-medium hidden sm:table-cell">Last run</th>
                  </tr>
                </thead>
                <tbody>
                  {byJob.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-16 text-center text-sm text-muted-foreground">
                        No sync history in the last 7 days
                      </td>
                    </tr>
                  ) : (
                    byJob.map(stat => {
                      const rate = stat.runs > 0
                        ? Math.round((stat.successfulRuns / stat.runs) * 100)
                        : 0
                      return (
                        <tr key={stat.jobId} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="py-3 pl-4 pr-2 text-sm font-medium">{stat.jobName}</td>
                          <td className="py-3 px-2 text-sm tabular-nums hidden sm:table-cell">
                            {stat.runs}
                          </td>
                          <td className="py-3 px-2">
                            <span
                              className={`text-sm tabular-nums font-medium ${
                                stat.runs === 0 ? 'text-muted-foreground' : rate < 90 ? 'text-amber-600' : 'text-green-600'
                              }`}
                            >
                              {stat.runs > 0 ? `${rate}%` : '—'}
                            </span>
                          </td>
                          <td className="py-3 px-2 text-sm text-muted-foreground hidden md:table-cell">
                            {formatBytes(stat.totalBytes)}
                          </td>
                          <td className="py-3 px-2 text-sm text-muted-foreground hidden lg:table-cell">
                            {fmtNum(stat.totalFiles)}
                          </td>
                          <td className="py-3 pl-2 pr-4 text-xs text-muted-foreground whitespace-nowrap hidden sm:table-cell">
                            {formatRelative(stat.lastRun ?? undefined)}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
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
