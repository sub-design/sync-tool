import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import JobCard from '@/components/JobCard'
import JobForm from '@/components/JobForm'
import { subscribe, useWsStore } from '@/lib/ws'
import * as api from '@/lib/api'

export default function Dashboard() {
  const queryClient = useQueryClient()
  const agentsOnline = useWsStore(s => s.agentsOnline)
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs'],
    queryFn: api.listJobs,
  })

  useEffect(() => {
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['jobs'] })
    const unsubs = [
      subscribe('job:status', invalidate),
      subscribe('job:complete', invalidate),
      subscribe('job:cancelled', invalidate),
      subscribe('job:error', invalidate),
    ]
    return () => unsubs.forEach(fn => fn())
  }, [queryClient])

  const agentCount = agentsOnline.size
  const hostnames = [...agentsOnline.values()]

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-3">
        <span style={{ fontSize: 16, fontWeight: 500 }}>SyncTool</span>

        <Tooltip>
          <TooltipTrigger className="flex items-center gap-1.5 text-sm">
            <span
              className={`inline-block size-2 rounded-full ${agentCount > 0 ? 'bg-green-500' : 'bg-red-500'}`}
            />
            {agentCount > 0 ? `${agentCount} agent online` : 'No agent connected'}
          </TooltipTrigger>
          <TooltipContent>
            {agentCount > 0 ? hostnames.join(', ') : 'No agents connected'}
          </TooltipContent>
        </Tooltip>
      </header>

      <main className="mx-auto w-full max-w-[960px] px-6 py-6 space-y-6">
        <div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus />
            New job
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent>
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
      </main>
    </div>
  )
}
