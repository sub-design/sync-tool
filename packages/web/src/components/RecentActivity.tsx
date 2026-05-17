import { CheckCircle2, XCircle, Clock, Loader2, ArrowRight, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { formatRelative } from '@/lib/format'
import type { Job } from '@/types'

interface Props {
  jobs: Job[]
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="size-4 text-green-600 flex-shrink-0" />
    case 'error':
      return <XCircle className="size-4 text-destructive flex-shrink-0" />
    case 'running':
    case 'queued':
      return <Loader2 className="size-4 text-amber-500 animate-spin flex-shrink-0" />
    default:
      return <Clock className="size-4 text-muted-foreground flex-shrink-0" />
  }
}

export default function RecentActivity({ jobs }: Props) {
  const navigate = useNavigate()

  const recent = [...jobs]
    .filter(j => j.lastRun != null || j.status === 'running' || j.status === 'queued')
    .sort((a, b) => (b.lastRun ?? 0) - (a.lastRun ?? 0))
    .slice(0, 5)

  if (recent.length === 0) return null

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h2 className="text-sm font-medium">Recent activity</h2>
        <button
          onClick={() => navigate('/jobs?tab=history')}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View all <ChevronRight className="size-3.5" />
        </button>
      </div>
      <div className="divide-y">
        {recent.map(job => (
          <div
            key={job.id}
            className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer"
            onClick={() => navigate(`/jobs/${job.id}`)}
          >
            <StatusIcon status={job.status} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{job.name}</p>
              <p className="text-xs text-muted-foreground font-mono truncate flex items-center gap-1">
                <span className="truncate max-w-[120px]">{job.source}</span>
                <ArrowRight className="size-2.5 flex-shrink-0" />
                <span className="truncate max-w-[120px]">{job.destination}</span>
              </p>
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatRelative(job.lastRun)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
