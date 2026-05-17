import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Shell from '@/components/Shell'
import MetricsGrid from '@/components/MetricsGrid'
import IssuesAlert from '@/components/IssuesAlert'
import RecentActivity from '@/components/RecentActivity'
import { subscribe } from '@/lib/ws'
import * as api from '@/lib/api'

export default function Dashboard() {
  const queryClient = useQueryClient()

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

  return (
    <Shell>
      <div className="space-y-6">
        <IssuesAlert jobs={jobs} />
        <MetricsGrid jobs={jobs} analytics={analytics} />
        <RecentActivity jobs={jobs} />
      </div>
    </Shell>
  )
}
