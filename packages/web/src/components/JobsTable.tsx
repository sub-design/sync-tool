import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowRight, ArrowLeft, ArrowLeftRight, Images,
  Play, StopCircle, Trash2, MoreHorizontal,
  ChevronUp, ChevronDown, ChevronsUpDown,
  CheckCircle2, XCircle, Loader2,
} from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatRelative } from '@/lib/format'
import { useWsStore } from '@/lib/ws'
import * as api from '@/lib/api'
import type { Job, JobStatus } from '@/types'

type SortKey = 'name' | 'direction' | 'status' | 'last-run'
type SortDir = 'asc' | 'desc'

const DIRECTION_ICON: Record<string, React.ElementType> = {
  ltr:   ArrowRight,
  rtl:   ArrowLeft,
  bidir: ArrowLeftRight,
}

const DIRECTION_LABEL: Record<string, string> = {
  ltr:   'Left → Right',
  rtl:   'Right → Left',
  bidir: 'Bidirectional',
}

function StatusBadge({ status }: { status: JobStatus }) {
  switch (status) {
    case 'idle':
      return <Badge variant="secondary">idle</Badge>
    case 'queued':
      return <Badge variant="outline" className="border-blue-300 text-blue-600">queued</Badge>
    case 'running':
      return (
        <Badge variant="outline" className="border-amber-300 text-amber-600 gap-1">
          <Loader2 className="animate-spin size-3" />syncing
        </Badge>
      )
    case 'completed':
      return (
        <Badge variant="outline" className="border-green-300 text-green-600 gap-1">
          <CheckCircle2 className="size-3" />done
        </Badge>
      )
    case 'cancelled':
      return <Badge variant="outline" className="border-slate-300 text-slate-500">cancelled</Badge>
    case 'error':
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="size-3" />error
        </Badge>
      )
  }
}

function SortHeader({
  label, sortKey, currentSort, currentDir, onSort,
}: {
  label: string
  sortKey: SortKey
  currentSort: SortKey
  currentDir: SortDir
  onSort: (key: SortKey) => void
}) {
  const active = currentSort === sortKey
  const Icon = active ? (currentDir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown
  return (
    <button
      className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      onClick={() => onSort(sortKey)}
    >
      {label}
      <Icon className="size-3.5" />
    </button>
  )
}

function BulkActionsBar({
  count, onStart, onStop, onDelete, onClear,
}: {
  count: number
  onStart: () => void
  onStop: () => void
  onDelete: () => void
  onClear: () => void
}) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg border bg-background shadow-lg px-4 py-2.5">
      <span className="text-sm font-medium mr-2">{count} selected</span>
      <Button size="sm" variant="outline" onClick={onStart}>
        <Play className="size-3.5 mr-1.5" />Start
      </Button>
      <Button size="sm" variant="outline" onClick={onStop}>
        <StopCircle className="size-3.5 mr-1.5" />Stop
      </Button>
      <Button
        size="sm" variant="outline"
        className="text-destructive hover:text-destructive border-destructive/30"
        onClick={onDelete}
      >
        <Trash2 className="size-3.5 mr-1.5" />Delete
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
    </div>
  )
}

interface Props {
  jobs: Job[]
  emptyMessage?: string
}

export default function JobsTable({ jobs, emptyMessage = 'No jobs.' }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const jobProgress = useWsStore(s => s.jobProgress)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = [...jobs].sort((a, b) => {
    let cmp = 0
    if (sortKey === 'name')      cmp = a.name.localeCompare(b.name)
    if (sortKey === 'direction') cmp = a.direction.localeCompare(b.direction)
    if (sortKey === 'status')    cmp = a.status.localeCompare(b.status)
    if (sortKey === 'last-run')  cmp = (a.lastRun ?? 0) - (b.lastRun ?? 0)
    return sortDir === 'asc' ? cmp : -cmp
  })

  const allSelected = sorted.length > 0 && sorted.every(j => selected.has(j.id))
  const someSelected = !allSelected && sorted.some(j => selected.has(j.id))

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(sorted.map(j => j.id)))
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleRun(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await api.runJob(id)
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    } catch {
      toast.error('Failed to start job')
    }
  }

  async function handleCancel(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await api.cancelJob(id)
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    } catch {
      toast.error('Failed to cancel job')
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete job "${name}"?`)) return
    try {
      await api.deleteJob(id)
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n })
      toast.success('Job deleted')
    } catch {
      toast.error('Failed to delete job')
    }
  }

  async function handleSaveAsTemplate(job: Job) {
    try {
      await api.createJobTemplate({
        name: `${job.name} Template`,
        description: `Created from job "${job.name}".`,
        defaults: {
          name: job.name,
          source: job.source,
          destination: job.destination,
          direction: job.direction,
          jobMode: job.jobMode,
          transferMode: job.transferMode,
          conflictStrategy: job.conflictStrategy,
          deletionPolicy: job.deletionPolicy,
          reliability: job.reliability,
          filters: job.filters,
          destinationLayout: job.destinationLayout,
          dateSource: job.dateSource,
          collisionPolicy: job.collisionPolicy,
          sourceDeviceId: job.sourceDeviceId,
          destinationDeviceId: job.destinationDeviceId,
          sourceEndpointId: job.sourceEndpointId,
          destinationEndpointId: job.destinationEndpointId,
          watch: job.watch,
          schedule: job.schedule,
          autoOptions: job.autoOptions,
        },
      })
      queryClient.invalidateQueries({ queryKey: ['job-templates'] })
      toast.success('Template saved')
    } catch {
      toast.error('Failed to save template')
    }
  }

  async function handleBulkStart() {
    await Promise.allSettled([...selected].map(id => api.runJob(id)))
    queryClient.invalidateQueries({ queryKey: ['jobs'] })
    setSelected(new Set())
  }

  async function handleBulkStop() {
    await Promise.allSettled([...selected].map(id => api.cancelJob(id)))
    queryClient.invalidateQueries({ queryKey: ['jobs'] })
    setSelected(new Set())
  }

  async function handleBulkDelete() {
    const ids = [...selected]
    if (!confirm(`Delete ${ids.length} job${ids.length > 1 ? 's' : ''}?`)) return
    await Promise.allSettled(ids.map(id => api.deleteJob(id)))
    queryClient.invalidateQueries({ queryKey: ['jobs'] })
    setSelected(new Set())
    toast.success(`${ids.length} job${ids.length > 1 ? 's' : ''} deleted`)
  }

  if (jobs.length === 0) {
    return (
      <div className="text-center py-16 text-sm text-muted-foreground">{emptyMessage}</div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="py-2.5 pl-4 pr-2 w-8">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
              </th>
              <th className="py-2.5 px-2 text-left">
                <SortHeader label="Job" sortKey="name" currentSort={sortKey} currentDir={sortDir} onSort={toggleSort} />
              </th>
              <th className="py-2.5 px-2 text-left hidden md:table-cell">
                <SortHeader label="Direction" sortKey="direction" currentSort={sortKey} currentDir={sortDir} onSort={toggleSort} />
              </th>
              <th className="py-2.5 px-2 text-left hidden lg:table-cell">
                <span className="text-xs font-medium text-muted-foreground">Endpoints</span>
              </th>
              <th className="py-2.5 px-2 text-left">
                <SortHeader label="Status" sortKey="status" currentSort={sortKey} currentDir={sortDir} onSort={toggleSort} />
              </th>
              <th className="py-2.5 px-2 text-left hidden sm:table-cell">
                <SortHeader label="Last run" sortKey="last-run" currentSort={sortKey} currentDir={sortDir} onSort={toggleSort} />
              </th>
              <th className="py-2.5 pl-2 pr-4" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(job => {
              const DirIcon = job.jobMode === 'import' ? Images : DIRECTION_ICON[job.direction] ?? ArrowRight
              const directionLabel = job.jobMode === 'import' ? 'Import by date' : DIRECTION_LABEL[job.direction]
              const isActive = job.status === 'running' || job.status === 'queued'
              const progress = jobProgress.get(job.id)

              return (
                <tr
                  key={job.id}
                  className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => navigate(`/jobs/${job.id}`)}
                >
                  <td className="py-3 pl-4 pr-2" onClick={e => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(job.id)}
                      onCheckedChange={() => toggleOne(job.id)}
                      aria-label={`Select ${job.name}`}
                    />
                  </td>
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-2">
                      <DirIcon className="size-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="font-medium text-sm">{job.name}</span>
                    </div>
                    {isActive && progress && (
                      <div className="mt-1.5 space-y-0.5 ml-5">
                        <Progress
                          value={progress.filesProcessed ?? 0}
                          max={progress.filesTotal ?? 100}
                          className="h-1"
                        />
                        {progress.currentFile && (
                          <p className="text-xs text-muted-foreground truncate max-w-xs">
                            {progress.currentFile}
                          </p>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-2 hidden md:table-cell">
                    <span className="text-xs text-muted-foreground">
                      {directionLabel}
                    </span>
                  </td>
                  <td className="py-3 px-2 hidden lg:table-cell">
                    <p className="text-xs text-muted-foreground font-mono truncate max-w-[220px]">
                      {job.source} → {job.destination}
                    </p>
                  </td>
                  <td className="py-3 px-2">
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="py-3 px-2 text-xs text-muted-foreground whitespace-nowrap hidden sm:table-cell">
                    {formatRelative(job.lastRun)}
                  </td>
                  <td className="py-3 pl-2 pr-4" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1 justify-end">
                      {isActive ? (
                        <Button
                          size="sm" variant="ghost" className="h-7 w-7 p-0"
                          title="Cancel" onClick={e => handleCancel(job.id, e)}
                        >
                          <StopCircle className="size-3.5" />
                        </Button>
                      ) : (
                        <Button
                          size="sm" variant="ghost" className="h-7 w-7 p-0"
                          title="Run now" onClick={e => handleRun(job.id, e)}
                        >
                          <Play className="size-3.5" />
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
                          <DropdownMenuItem onClick={() => handleSaveAsTemplate(job)}>
                            Save as template
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleDelete(job.id, job.name)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && (
        <BulkActionsBar
          count={selected.size}
          onStart={handleBulkStart}
          onStop={handleBulkStop}
          onDelete={handleBulkDelete}
          onClear={() => setSelected(new Set())}
        />
      )}
    </>
  )
}
