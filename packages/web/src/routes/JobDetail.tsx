import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, MoreHorizontal, Pencil, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import SyncLogTable from '@/components/SyncLogTable'
import JobForm from '@/components/JobForm'
import { useWsStore, subscribe } from '@/lib/ws'
import { formatRelative, formatBytes } from '@/lib/format'
import * as api from '@/lib/api'
import type { JobDirection, JobStatus } from '../types'

const DIRECTION_LABEL: Record<JobDirection, string> = {
  ltr:   'Left → Right',
  rtl:   'Right → Left',
  bidir: 'Both ways',
}

function StatusBadge({ status }: { status: JobStatus }) {
  switch (status) {
    case 'idle':
      return <Badge variant="secondary">idle</Badge>
    case 'queued':
      return <Badge variant="outline" className="border-blue-300 text-blue-600">queued</Badge>
    case 'running':
      return (
        <Badge variant="outline" className="border-amber-300 text-amber-600">
          <Loader2 className="animate-spin" />
          syncing…
        </Badge>
      )
    case 'completed':
      return <Badge variant="outline" className="border-green-300 text-green-600">done</Badge>
    case 'cancelled':
      return <Badge variant="outline" className="border-slate-300 text-slate-600">cancelled</Badge>
    case 'error':
      return <Badge variant="destructive">error</Badge>
  }
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const jobProgress = useWsStore(s => s.jobProgress)

  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const { data: job } = useQuery({
    queryKey: ['job', id],
    queryFn: () => api.getJob(id!),
    enabled: !!id,
  })

  const { data: logData } = useQuery({
    queryKey: ['log', id],
    queryFn: () => api.getJobLog(id!, 50),
    enabled: !!id,
  })

  useEffect(() => {
    if (!id) return
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ['job', id] })
      queryClient.invalidateQueries({ queryKey: ['log', id] })
    }
    const unsubs = [
      subscribe('job:status', msg => { if (msg.jobId === id) invalidate() }),
      subscribe('job:progress', msg => { if (msg.progress.jobId === id) invalidate() }),
      subscribe('job:complete', msg => { if (msg.result.jobId === id) invalidate() }),
      subscribe('job:cancelled', msg => { if (msg.jobId === id) invalidate() }),
      subscribe('job:error', msg => { if (msg.jobId === id) invalidate() }),
    ]
    return () => unsubs.forEach(fn => fn())
  }, [id, queryClient])

  async function handleRun() {
    if (!id) return
    await api.runJob(id)
    queryClient.invalidateQueries({ queryKey: ['job', id] })
  }

  async function handleCancel() {
    if (!id) return
    await api.cancelJob(id)
    queryClient.invalidateQueries({ queryKey: ['job', id] })
  }

  async function handleDelete() {
    if (!id) return
    await api.deleteJob(id)
    navigate('/')
  }

  const isActive = job?.status === 'running' || job?.status === 'queued'
  const progress = id ? jobProgress.get(id) : undefined

  return (
    <div className="min-h-screen flex flex-col">
      <main className="mx-auto w-full max-w-[960px] px-6 py-6 space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft />
          Back
        </Button>

        {job && (
          <>
            <Card>
              <CardContent style={{ padding: 20 }} className="space-y-4">
                {/* Row 1: name + actions */}
                <div className="flex items-center justify-between gap-4">
                  <h2 style={{ fontSize: 20 }} className="font-semibold">{job.name}</h2>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" disabled={isActive} onClick={handleRun}>
                      <Play size={14} />
                      Run
                    </Button>
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
                        <Button size="sm" variant="outline">
                          <MoreHorizontal size={14} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDeleteOpen(true)}
                        >
                          Delete…
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* Row 2: paths + direction */}
                <div className="flex gap-12 text-sm text-muted-foreground">
                  <span>Source: <span className="font-mono">{job.source}</span></span>
                  <span>Destination: <span className="font-mono">{job.destination}</span></span>
                  <span>Direction: {DIRECTION_LABEL[job.direction]}</span>
                </div>

                {/* Row 3: status + last run + error */}
                <div className="flex items-center gap-4">
                  <StatusBadge status={job.status} />
                  <span className="text-sm text-muted-foreground">
                    Last run: {formatRelative(job.lastRun)}
                  </span>
                  {job.lastError && job.status === 'error' && (
                    <span className="text-xs text-destructive">{job.lastError}</span>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Live progress */}
            {job.status === 'running' && (
              <Card className="border-l-4 border-amber-500">
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
                  <Progress
                    value={progress?.filesProcessed ?? 0}
                    max={progress?.filesTotal ?? 100}
                  />
                  <p className="text-sm text-muted-foreground">
                    {progress?.filesProcessed ?? 0} of {progress?.filesTotal ?? 0} files
                    {' · '}
                    {formatBytes(progress?.bytesTransferred ?? 0)}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Sync history */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Sync history</h3>
              <SyncLogTable entries={(logData as any[]) ?? []} jobId={id!} />
            </div>

            {/* Edit dialog */}
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogContent>
                <DialogTitle>Edit job</DialogTitle>
                <JobForm
                  job={job}
                  onSuccess={() => {
                    setEditOpen(false)
                    queryClient.invalidateQueries({ queryKey: ['job', id] })
                  }}
                  onCancel={() => setEditOpen(false)}
                />
              </DialogContent>
            </Dialog>

            {/* Delete alert dialog */}
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
                  <AlertDialogAction variant="destructive" onClick={handleDelete}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </main>
    </div>
  )
}
