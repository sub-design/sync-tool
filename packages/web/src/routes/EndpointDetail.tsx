import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Circle, MoreHorizontal, Pencil, Trash2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import Shell from '@/components/Shell'
import { endpointsApi } from '@/lib/endpoints'
import * as api from '@/lib/api'
import { TypeBadge, endpointSummary, endpointConfigRows } from '@/lib/endpoint-meta'
import { formatAbsolute } from '@/lib/format'
import type { Job } from '../types'
// EndpointDialog is not exported from Endpoints.tsx, so we open edit inline here
// We re-use a lightweight inline edit trigger that navigates back to /endpoints with ?edit=id
// For simplicity we use a dialog imported from a shared component.
// Since EndpointDialog lives in Endpoints.tsx (not exported), we inline the delete only
// and use navigation for edit (opens list page which handles editing).

export default function EndpointDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState('overview')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [conflictJobs, setConflictJobs] = useState<Array<{ id: string; name: string }>>([])

  const { data: endpoint, isLoading } = useQuery({
    queryKey: ['endpoint', id],
    queryFn: () => endpointsApi.get(id!),
    enabled: !!id,
  })

  const { data: allJobs = [] } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: api.listJobs,
  })

  const usedByJobs = allJobs.filter(
    j => j.sourceEndpointId === id || j.destinationEndpointId === id,
  )

  const deleteMutation = useMutation({
    mutationFn: () => endpointsApi.delete(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['endpoints'] })
      toast.success('Endpoint deleted')
      navigate('/endpoints')
    },
    onError: async (err: Error & { response?: Response }) => {
      if (err.message.startsWith('409')) {
        try {
          const body = await err.response?.json() as { jobs?: Array<{ id: string; name: string }> } | undefined
          if (body?.jobs) { setConflictJobs(body.jobs); return }
        } catch { /* ignore */ }
      }
      toast.error(err.message)
    },
  })

  if (isLoading) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
          <Loader2 className="animate-spin" size={16} /> Loading…
        </div>
      </Shell>
    )
  }

  if (!endpoint) {
    return (
      <Shell>
        <div className="py-12 text-center text-sm text-muted-foreground">
          Endpoint not found.{' '}
          <button className="underline underline-offset-2 hover:text-foreground" onClick={() => navigate('/endpoints')}>
            Back to Endpoints
          </button>
        </div>
      </Shell>
    )
  }

  const path = endpointSummary(endpoint)
  const configRows = endpointConfigRows(endpoint)

  return (
    <Shell>
      <div className="space-y-6">
        {/* Breadcrumb */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <button onClick={() => navigate('/endpoints')}>Endpoints</button>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{endpoint.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{endpoint.name}</h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-mono">{path}</span>
              <span>·</span>
              <TypeBadge type={endpoint.type} />
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={() => navigate(`/endpoints?edit=${id}`)}>
              <Pencil size={14} />
              Edit
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline"><MoreHorizontal size={14} /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                  <Trash2 size={14} className="mr-2" />
                  Delete endpoint…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="jobs">
              Jobs
              {usedByJobs.length > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-muted px-1 text-[11px] font-semibold text-muted-foreground">
                  {usedByJobs.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Overview ── */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            {/* Connection Details */}
            <Card>
              <div className="flex items-center px-5 h-11 border-b border-border">
                <h3 className="font-medium">Connection details</h3>
              </div>
              <dl className="divide-y divide-border">
                <div className="flex items-center px-5 h-10">
                  <dt className="text-muted-foreground w-40 text-sm">Status</dt>
                  <dd className="flex items-center gap-2 text-sm">
                    <Circle className="w-2 h-2 fill-green-600 text-green-600" aria-hidden />
                    <span className="text-green-700">Active</span>
                  </dd>
                </div>
                <div className="flex items-center px-5 h-10">
                  <dt className="text-muted-foreground w-40 text-sm">Type</dt>
                  <dd><TypeBadge type={endpoint.type} /></dd>
                </div>
                {configRows.map(row => (
                  <div key={row.label} className="flex items-center px-5 h-10">
                    <dt className="text-muted-foreground w-40 text-sm">{row.label}</dt>
                    <dd className="font-mono text-sm break-all">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </Card>

            {/* Endpoint Information */}
            <Card>
              <div className="flex items-center px-5 h-11 border-b border-border">
                <h3 className="font-medium">Endpoint information</h3>
              </div>
              <dl className="divide-y divide-border">
                <div className="flex items-center px-5 h-10">
                  <dt className="text-muted-foreground w-40 text-sm">Used by</dt>
                  <dd className="text-sm tabular-nums">
                    {usedByJobs.length === 0
                      ? <span className="text-muted-foreground">No jobs</span>
                      : `${usedByJobs.length} ${usedByJobs.length === 1 ? 'job' : 'jobs'}`}
                  </dd>
                </div>
                <div className="flex items-center px-5 h-10">
                  <dt className="text-muted-foreground w-40 text-sm">Created</dt>
                  <dd className="text-sm tabular-nums">{formatAbsolute(endpoint.createdAt)}</dd>
                </div>
                <div className="flex items-center px-5 h-10">
                  <dt className="text-muted-foreground w-40 text-sm">Last modified</dt>
                  <dd className="text-sm tabular-nums">{formatAbsolute(endpoint.updatedAt)}</dd>
                </div>
              </dl>
            </Card>

            {/* Delete zone */}
            <div className="flex justify-end">
              <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                <Trash2 size={14} />
                Delete endpoint
              </Button>
            </div>
          </TabsContent>

          {/* ── Jobs ── */}
          <TabsContent value="jobs" className="mt-4">
            {usedByJobs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
                No jobs are using this endpoint.
              </div>
            ) : (
              <Card className="overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Job name</th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Role</th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {usedByJobs.map(job => {
                      const isSource = job.sourceEndpointId === id
                      const isDest   = job.destinationEndpointId === id
                      const role     = isSource && isDest ? 'Source & Destination' : isSource ? 'Source (Left)' : 'Destination (Right)'
                      return (
                        <tr
                          key={job.id}
                          className="hover:bg-muted/40 cursor-pointer transition-colors"
                          onClick={() => navigate(`/jobs/${job.id}`)}
                        >
                          <td className="px-5 py-2.5 font-medium">{job.name}</td>
                          <td className="px-5 py-2.5 text-muted-foreground">{role}</td>
                          <td className="px-5 py-2.5 capitalize text-muted-foreground">{job.status}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Delete dialog */}
        <AlertDialog open={deleteOpen} onOpenChange={v => { if (!v) { setDeleteOpen(false); setConflictJobs([]) } }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete endpoint "{endpoint.name}"?</AlertDialogTitle>
              <AlertDialogDescription>
                {conflictJobs.length > 0 ? (
                  <>
                    This endpoint is used by the following jobs — unlink them first:
                    <ul className="mt-2 list-disc pl-4 text-foreground">
                      {conflictJobs.map(j => <li key={j.id}>{j.name}</li>)}
                    </ul>
                  </>
                ) : (
                  'This action cannot be undone. Jobs that reference this endpoint will fall back to their stored URI.'
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              {conflictJobs.length === 0 && (
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending && <Loader2 className="animate-spin" />}
                  Delete
                </AlertDialogAction>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Shell>
  )
}
