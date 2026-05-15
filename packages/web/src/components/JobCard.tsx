import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowLeftRight, ArrowRight, Clock, Loader2, Play } from 'lucide-react'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useWsStore } from '@/lib/ws'
import { formatRelative } from '@/lib/format'
import { describeCron } from '@/lib/cron'
import * as api from '@/lib/api'
import type { Job, JobDirection, JobStatus } from '../types'

const directionConfig: Record<JobDirection, { label: string; Icon: React.ElementType }> = {
  ltr:   { label: '→ Right only', Icon: ArrowRight },
  rtl:   { label: '← Left only',  Icon: ArrowLeft },
  bidir: { label: '↔ Both ways',  Icon: ArrowLeftRight },
}

export default function JobCard({ job }: { job: Job }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const jobProgress = useWsStore(s => s.jobProgress)
  const progress = jobProgress.get(job.id)

  async function handleRun(e: React.MouseEvent) {
    e.stopPropagation()
    await api.runJob(job.id)
    queryClient.invalidateQueries({ queryKey: ['jobs'] })
  }

  const { label, Icon } = directionConfig[job.direction]
  const isActive = job.status === 'running' || job.status === 'queued'

  return (
    <Card className="cursor-pointer" onClick={() => navigate(`/jobs/${job.id}`)}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="font-medium">{job.name}</CardTitle>
          <div className="flex items-center gap-1.5 shrink-0">
            {job.schedule && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="flex items-center gap-1 font-normal cursor-default">
                    <Clock className="size-3" />
                    {job.schedule}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{describeCron(job.schedule)}</TooltipContent>
              </Tooltip>
            )}
            <Badge variant="outline" className="flex items-center gap-1">
              <Icon className="size-3" />
              {label}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        <p className="truncate font-mono text-sm text-muted-foreground">
          {job.source} → {job.destination}
        </p>
        {job.status === 'running' && (
          <div className="space-y-1">
            <Progress
              value={progress?.filesProcessed ?? 0}
              max={progress?.filesTotal ?? 100}
            />
            {progress?.currentFile && (
              <p className="truncate text-xs text-muted-foreground">{progress.currentFile}</p>
            )}
          </div>
        )}
      </CardContent>

      <CardFooter className="justify-between">
        <StatusBadge status={job.status} />
        <span className="text-xs text-muted-foreground">{formatRelative(job.lastRun)}</span>
        <Button
          size="sm"
          variant="ghost"
          disabled={isActive}
          onClick={handleRun}
        >
          <Play />
        </Button>
      </CardFooter>
    </Card>
  )
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
