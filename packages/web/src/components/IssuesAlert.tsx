import { AlertTriangle, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Job } from '@/types'

interface Props {
  jobs: Job[]
}

export default function IssuesAlert({ jobs }: Props) {
  const navigate = useNavigate()
  const failedJobs = jobs.filter(j => j.status === 'error')

  if (failedJobs.length === 0) return null

  const preview =
    failedJobs.length === 1
      ? failedJobs[0].name
      : failedJobs
          .slice(0, 3)
          .map(j => j.name)
          .join(', ') + (failedJobs.length > 3 ? ` +${failedJobs.length - 3} more` : '')

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="size-4 text-destructive mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-destructive">
            {failedJobs.length} job{failedJobs.length > 1 ? 's' : ''} failed
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{preview}</p>
        </div>
        <button
          onClick={() => navigate('/jobs?status=error')}
          className="flex items-center gap-1 text-xs text-destructive hover:underline flex-shrink-0"
        >
          View <ArrowRight className="size-3" />
        </button>
      </div>
    </div>
  )
}
