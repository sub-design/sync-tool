import { useEffect, useMemo, useState } from 'react'
import type { ElementType } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeftRight, Code2, Copy, FileText, Images, Plus } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import Shell from '@/components/Shell'
import JobForm from '@/components/JobForm'
import JobsTable from '@/components/JobsTable'
import { formatBytes, formatRelative } from '@/lib/format'
import { subscribe } from '@/lib/ws'
import { getJobPreset, JOB_PRESETS, type JobPreset, type JobPresetIcon, type JobPresetId } from '@/jobPresets'
import * as api from '@/lib/api'
import type { JobTemplate } from '@/types'

type StatusFilter = 'all' | 'running' | 'error' | 'completed' | 'idle'
type JobCreationChoice = `preset:${JobPresetId}` | `template:${string}` | 'blank'

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all',       label: 'All' },
  { id: 'running',   label: 'Running' },
  { id: 'error',     label: 'Failed' },
  { id: 'completed', label: 'Done' },
  { id: 'idle',      label: 'Idle' },
]

const PRESET_ICONS: Record<JobPresetIcon, ElementType> = {
  images: Images,
  copy: Copy,
  sync: ArrowLeftRight,
  code: Code2,
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export default function Jobs() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [creationChoice, setCreationChoice] = useState<JobCreationChoice | null>(null)

  const initialTab = searchParams.get('tab') === 'history' ? 'history' : 'all-jobs'
  const initialStatus = (STATUS_FILTERS.find(f => f.id === searchParams.get('status'))?.id) ?? 'all'

  const [activeTab, setActiveTab] = useState(initialTab)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus)

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs'],
    queryFn: api.listJobs,
  })

  const { data: templates = [] } = useQuery({
    queryKey: ['job-templates'],
    queryFn: api.listJobTemplates,
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
  const selectedPresetId = creationChoice?.startsWith('preset:') ? creationChoice.slice('preset:'.length) as JobPresetId : null
  const selectedTemplateId = creationChoice?.startsWith('template:') ? creationChoice.slice('template:'.length) : null
  const selectedPreset = selectedPresetId ? getJobPreset(selectedPresetId) : undefined
  const selectedTemplate = selectedTemplateId ? templates.find((template) => template.id === selectedTemplateId) : undefined

  function openNewJobDialog() {
    setCreationChoice(null)
    setDialogOpen(true)
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open)
    if (!open) setCreationChoice(null)
  }

  return (
    <Shell>
      <div className="space-y-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <TabsList>
              <TabsTrigger value="all-jobs">All Jobs</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
            <Button size="sm" onClick={openNewJobDialog}>
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

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          className={
            creationChoice
              ? 'gap-0 overflow-hidden p-0 sm:max-w-6xl [&>button]:right-5 [&>button]:top-5'
              : 'sm:max-w-3xl'
          }
        >
          <DialogTitle className={creationChoice ? 'border-b px-5 py-4 pr-12 text-base' : undefined}>
            {creationChoice ? (selectedPreset ? `New job from: ${selectedPreset.name}` : selectedTemplate ? `New job from template: ${selectedTemplate.name}` : 'New blank job') : 'Choose a job template'}
          </DialogTitle>
          {!creationChoice ? (
            <PresetPicker templates={templates} onSelect={setCreationChoice} />
          ) : (
            <JobForm
              key={creationChoice}
              presetDefaults={selectedPreset?.defaults ?? selectedTemplate?.defaults}
              presetLabel={selectedPreset?.name ?? selectedTemplate?.name}
              templateId={selectedTemplate?.id}
              onClearPreset={() => setCreationChoice('blank')}
              onCancel={() => setDialogOpen(false)}
              onSuccess={() => {
                setDialogOpen(false)
                setCreationChoice(null)
                queryClient.invalidateQueries({ queryKey: ['jobs'] })
                toast.success('Job created')
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Shell>
  )
}

function PresetPicker({ templates, onSelect }: { templates: JobTemplate[]; onSelect: (choice: JobCreationChoice) => void }) {
  return (
    <div className="space-y-4">
      {templates.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Saved templates</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => onSelect(`template:${template.id}`)}
                className="rounded-lg border p-4 text-left transition-colors hover:bg-accent"
              >
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-background">
                    <FileText className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-medium">{template.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{template.description || templateSummary(template)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Built-in presets</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {JOB_PRESETS.map((preset) => (
          <PresetCard key={preset.id} preset={preset} onSelect={() => onSelect(`preset:${preset.id}`)} />
        ))}
        <button
          type="button"
          onClick={() => onSelect('blank')}
          className="rounded-lg border p-4 text-left transition-colors hover:bg-accent"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-md border bg-background">
              <FileText className="size-5" />
            </div>
            <div>
              <h3 className="font-medium">Blank job</h3>
              <p className="mt-1 text-sm text-muted-foreground">Start with the current default form.</p>
            </div>
          </div>
        </button>
      </div>
      </div>
    </div>
  )
}

function templateSummary(template: JobTemplate): string {
  if (template.defaults.jobMode === 'import') return 'Import job settings'
  if (template.defaults.direction === 'bidir') return 'Bidirectional sync settings'
  return 'Backup sync settings'
}

function PresetCard({ preset, onSelect }: { preset: JobPreset; onSelect: () => void }) {
  const Icon = PRESET_ICONS[preset.icon]

  return (
    <button
      type="button"
      onClick={onSelect}
      className="rounded-lg border p-4 text-left transition-colors hover:bg-accent"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-background">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <h3 className="font-medium">{preset.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{preset.description}</p>
        </div>
      </div>
    </button>
  )
}
