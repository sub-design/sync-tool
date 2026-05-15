import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import Shell from '@/components/Shell'
import JobCard from '@/components/JobCard'
import JobForm from '@/components/JobForm'
import { subscribe } from '@/lib/ws'
import * as api from '@/lib/api'

export default function Dashboard() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs'],
    queryFn: api.listJobs,
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
      <div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus />
          New job
        </Button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-3xl">
            <DialogTitle>New job</DialogTitle>
            <JobForm
              onSuccess={() => {
                setDialogOpen(false)
                queryClient.invalidateQueries({ queryKey: ['jobs'] })
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {jobs.length === 0 ? (
        <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
          No jobs yet. Create your first sync job.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {jobs.map(job => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </Shell>
  )
}
