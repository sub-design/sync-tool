import { useMemo, useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  HardDrive, Server,
  Plus, Pencil, Trash2, Loader2, MoreVertical, Circle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { FilterChipGroup, FilterChip, FilterChipCount } from '@/components/ui/filter-chip'
import { SortableTableHeader, type SortDirection } from '@/components/ui/sortable-table-header'
import { BulkActionsBar } from '@/components/BulkActionsBar'
import Shell from '@/components/Shell'
import { endpointsApi } from '@/lib/endpoints'
import * as api from '@/lib/api'
import { TYPE_META, TypeBadge, endpointSummary } from '@/lib/endpoint-meta'
import { formatAbsolute } from '@/lib/format'
import type { Endpoint, BackendType, SavedEndpointConfig, Job } from '../types'

// ── Config fields ─────────────────────────────────────────────────────────────

function ConfigFields({ type, config, onChange }: {
  type: BackendType
  config: SavedEndpointConfig
  onChange: (patch: Partial<SavedEndpointConfig>) => void
}) {
  const field = (
    id: string, label: string, key: keyof SavedEndpointConfig,
    opts: { type?: string; placeholder?: string } = {},
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={opts.type ?? 'text'}
        placeholder={opts.placeholder}
        value={(config[key] as string | number | undefined) ?? ''}
        onChange={e => onChange({ [key]: e.target.value || undefined })}
      />
    </div>
  )

  if (type === 'local')
    return field('ep-path', 'Path', 'path', { placeholder: '/mnt/backup or C:\\Backup' })

  if (type === 's3') return (
    <>
      {field('ep-bucket', 'Bucket *', 'bucket', { placeholder: 'my-backup-bucket' })}
      {field('ep-region', 'Region', 'region', { placeholder: 'us-east-1' })}
      {field('ep-prefix', 'Key prefix', 'remotePath', { placeholder: 'backups/prod' })}
      {field('ep-endpoint', 'Custom endpoint', 'endpoint', { placeholder: 'https://s3.example.com' })}
      {field('ep-access-key', 'Access key ID', 'accessKeyId', { placeholder: 'AKIA…' })}
      {field('ep-secret-key', 'Secret access key', 'secretAccessKey', { type: 'password', placeholder: '••••••••' })}
    </>
  )

  if (type === 'smb') return (
    <>
      {field('ep-host', 'Host *', 'host', { placeholder: 'nas.local or 192.168.1.5' })}
      {field('ep-share', 'Share', 'share', { placeholder: 'Backups' })}
      {field('ep-remote-path', 'Sub-path', 'remotePath', { placeholder: 'projects/2024' })}
      {field('ep-user', 'Username', 'username', { placeholder: 'DOMAIN\\user' })}
      {field('ep-pass', 'Password', 'password', { type: 'password', placeholder: '••••••••' })}
    </>
  )

  if (type === 'nfs') return (
    <>
      {field('ep-host', 'Host *', 'host', { placeholder: 'nas.local or 192.168.1.5' })}
      {field('ep-remote-path', 'Export path', 'remotePath', { placeholder: '/export/data' })}
    </>
  )

  const defaultPorts: Record<string, string> = { sftp: '22', ftp: '21', ftps: '990' }
  return (
    <>
      {field('ep-host', 'Host *', 'host', { placeholder: 'sftp.example.com' })}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ep-port">Port</Label>
        <Input
          id="ep-port"
          type="number"
          placeholder={defaultPorts[type]}
          value={config.port ?? ''}
          onChange={e => onChange({ port: e.target.value ? Number(e.target.value) : undefined })}
        />
      </div>
      {field('ep-remote-path', 'Remote path', 'remotePath', { placeholder: '/home/user/backup' })}
      {field('ep-user', 'Username', 'username')}
      {field('ep-pass', 'Password', 'password', { type: 'password', placeholder: '••••••••' })}
      {type === 'sftp' && field('ep-key', 'SSH key path (on agent)', 'keyPath', { placeholder: '~/.ssh/id_rsa' })}
    </>
  )
}

// ── Endpoint dialog ───────────────────────────────────────────────────────────

interface EndpointFormData {
  name: string; type: BackendType; config: SavedEndpointConfig; deviceId: string
}

const EMPTY_FORM: EndpointFormData = { name: '', type: 'local', config: {}, deviceId: '' }

function endpointToForm(ep: Endpoint): EndpointFormData {
  return { name: ep.name, type: ep.type, config: { ...ep.config }, deviceId: ep.deviceId ?? '' }
}

function EndpointDialog({ open, onClose, initial }: {
  open: boolean; onClose: () => void; initial?: Endpoint
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<EndpointFormData>(initial ? endpointToForm(initial) : EMPTY_FORM)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) setForm(initial ? endpointToForm(initial) : EMPTY_FORM)
  }, [open, initial])

  const setConfig = (patch: Partial<SavedEndpointConfig>) =>
    setForm(f => ({ ...f, config: { ...f.config, ...patch } }))

  const mutation = useMutation({
    mutationFn: () => {
      const payload = { name: form.name.trim(), type: form.type, config: form.config, deviceId: form.deviceId || undefined }
      return initial ? endpointsApi.update(initial.id, payload) : endpointsApi.create(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['endpoints'] })
      toast.success(initial ? 'Endpoint updated' : 'Endpoint created')
      onClose()
    },
    onError: (err: Error) => setError(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit endpoint' : 'New endpoint'}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ep-name">Name *</Label>
            <Input
              id="ep-name"
              placeholder="Production NAS, S3 Backup…"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Type *</Label>
            <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as BackendType, config: {} }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(TYPE_META) as BackendType[]).map(t => (
                  <SelectItem key={t} value={t}>
                    <span className="flex items-center gap-2">{TYPE_META[t].icon} {TYPE_META[t].label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ConfigFields type={form.type} config={form.config} onChange={setConfig} />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.name.trim()}>
            {mutation.isPending && <Loader2 className="animate-spin" />}
            {initial ? 'Save changes' : 'Create endpoint'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Delete dialog ─────────────────────────────────────────────────────────────

function DeleteDialog({ endpoint, onClose }: { endpoint: Endpoint | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [conflictJobs, setConflictJobs] = useState<Array<{ id: string; name: string }>>([])

  const mutation = useMutation({
    mutationFn: () => endpointsApi.delete(endpoint!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['endpoints'] })
      toast.success('Endpoint deleted')
      onClose()
    },
    onError: async (err: Error & { response?: Response }) => {
      if (err.message.startsWith('409')) {
        try {
          const body = await err.response?.json() as { jobs?: Array<{ id: string; name: string }> } | undefined
          if (body?.jobs) { setConflictJobs(body.jobs); return }
        } catch { /* ignore */ }
      }
      setConflictJobs([])
    },
  })

  if (!endpoint) return null

  return (
    <AlertDialog open onOpenChange={v => !v && onClose()}>
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
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          {conflictJobs.length === 0 && (
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
            >
              {mutation.isPending && <Loader2 className="animate-spin" />}
              Delete
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EndpointsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const editId = searchParams.get('edit')

  const [typeFilter, setTypeFilter]     = useState<string[]>([])
  const [sortBy, setSortBy]             = useState('name')
  const [sortDir, setSortDir]           = useState<SortDirection>('asc')
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [deleting, setDeleting]         = useState<Endpoint | null>(null)
  const [createOpen, setCreateOpen]     = useState(false)

  const { data: endpoints = [], isLoading } = useQuery({
    queryKey: ['endpoints'],
    queryFn: endpointsApi.list,
  })

  const { data: allJobs = [] } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: api.listJobs,
  })

  // Endpoint being edited via ?edit=id param
  const editingEndpoint = editId ? endpoints.find(e => e.id === editId) : undefined
  const isEditDialogOpen = !!editId && !!editingEndpoint

  function closeEditDialog() {
    searchParams.delete('edit')
    setSearchParams(searchParams, { replace: true })
  }

  // Compute usedBy count for each endpoint
  const usedByMap = useMemo(() => {
    const map: Record<string, number> = {}
    for (const job of allJobs) {
      if (job.sourceEndpointId)      map[job.sourceEndpointId]      = (map[job.sourceEndpointId]      ?? 0) + 1
      if (job.destinationEndpointId) map[job.destinationEndpointId] = (map[job.destinationEndpointId] ?? 0) + 1
    }
    return map
  }, [allJobs])

  // Type options for filter chips
  const typeOptions = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const ep of endpoints) counts[ep.type] = (counts[ep.type] ?? 0) + 1
    return Object.entries(counts).map(([type, count]) => ({
      value: type,
      label: TYPE_META[type as BackendType]?.label ?? type,
      count,
    }))
  }, [endpoints])

  const filtered = useMemo(() => {
    return endpoints
      .filter(ep => typeFilter.length === 0 || typeFilter.includes(ep.type))
      .sort((a, b) => {
        let result = 0
        if (sortBy === 'name')     result = a.name.localeCompare(b.name)
        else if (sortBy === 'type')    result = a.type.localeCompare(b.type)
        else if (sortBy === 'path')    result = endpointSummary(a).localeCompare(endpointSummary(b))
        else if (sortBy === 'used-by') result = (usedByMap[a.id] ?? 0) - (usedByMap[b.id] ?? 0)
        else if (sortBy === 'created') result = a.createdAt - b.createdAt
        return sortDir === 'asc' ? result : -result
      })
  }, [endpoints, typeFilter, sortBy, sortDir, usedByMap])

  function handleSort(key: string) {
    if (sortBy === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(key); setSortDir('asc') }
  }

  const filteredIds = filtered.map(e => e.id)
  const allSelected = filteredIds.length > 0 && filteredIds.every(id => selectedIds.has(id))
  const someSelected = filteredIds.some(id => selectedIds.has(id))

  function handleSelectAll(checked: boolean) {
    const next = new Set(selectedIds)
    if (checked) filteredIds.forEach(id => next.add(id))
    else filteredIds.forEach(id => next.delete(id))
    setSelectedIds(next)
  }

  function handleSelectRow(id: string, checked: boolean) {
    const next = new Set(selectedIds)
    if (checked) next.add(id)
    else next.delete(id)
    setSelectedIds(next)
  }

  return (
    <Shell>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Endpoints</h1>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus size={16} /> Add endpoint
          </Button>
        </div>

        {/* Filter chips */}
        {typeOptions.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <FilterChipGroup value={typeFilter} onValueChange={setTypeFilter}>
              <FilterChip value="all">
                All <FilterChipCount>{endpoints.length}</FilterChipCount>
              </FilterChip>
              {typeOptions.map(opt => (
                <FilterChip key={opt.value} value={opt.value}>
                  {opt.label} <FilterChipCount>{opt.count}</FilterChipCount>
                </FilterChip>
              ))}
            </FilterChipGroup>
          </div>
        )}

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
            <Loader2 className="animate-spin" size={16} /> Loading…
          </div>
        ) : endpoints.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
            <Server size={32} className="mx-auto mb-3 opacity-30" />
            No endpoints yet.{' '}
            <button className="underline underline-offset-2 hover:text-foreground" onClick={() => setCreateOpen(true)}>
              Create your first endpoint
            </button>{' '}
            to reuse connection configs across jobs.
          </div>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full">
              <thead className="border-b border-border">
                <tr>
                  <th scope="col" className="w-10 px-5 h-9">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                      onCheckedChange={checked => handleSelectAll(checked === true)}
                      aria-label="Select all endpoints"
                    />
                  </th>
                  <SortableTableHeader label="Endpoint name" active={sortBy === 'name'}    direction={sortDir} onClick={() => handleSort('name')} />
                  <SortableTableHeader label="Type"          active={sortBy === 'type'}    direction={sortDir} onClick={() => handleSort('type')} />
                  <SortableTableHeader label="Path"          active={sortBy === 'path'}    direction={sortDir} onClick={() => handleSort('path')} className="hidden lg:table-cell" />
                  <th scope="col" className="px-6 h-9 text-left text-xs font-medium text-muted-foreground">Status</th>
                  <SortableTableHeader label="Used by"       active={sortBy === 'used-by'} direction={sortDir} onClick={() => handleSort('used-by')} className="hidden md:table-cell" />
                  <SortableTableHeader label="Created"       active={sortBy === 'created'} direction={sortDir} onClick={() => handleSort('created')} className="hidden sm:table-cell" />
                  <th scope="col" className="w-12" aria-label="Row actions" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(ep => {
                  const usedBy = usedByMap[ep.id] ?? 0
                  const icon = TYPE_META[ep.type]?.icon ?? <HardDrive size={16} className="text-muted-foreground" />
                  return (
                    <tr
                      key={ep.id}
                      onClick={() => navigate(`/endpoints/${ep.id}`)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/endpoints/${ep.id}`) } }}
                      tabIndex={0}
                      aria-label={`View details for ${ep.name}`}
                      className="hover:bg-muted/40 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    >
                      <td className="px-5 py-2.5" onClick={e => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(ep.id)}
                          onCheckedChange={checked => handleSelectRow(ep.id, checked === true)}
                          aria-label={`Select ${ep.name}`}
                        />
                      </td>
                      <td className="px-6 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">{icon}</span>
                          <span className="font-medium text-foreground">{ep.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-2.5">
                        <TypeBadge type={ep.type} />
                      </td>
                      <td className="px-6 py-2.5 hidden lg:table-cell">
                        <span className="font-mono text-sm text-muted-foreground truncate max-w-xs block">
                          {endpointSummary(ep)}
                        </span>
                      </td>
                      <td className="px-6 py-2.5">
                        <div className="flex items-center gap-2">
                          <Circle className="w-2 h-2 fill-green-600 text-green-600" aria-hidden />
                          <span className="text-green-700 text-sm">Active</span>
                        </div>
                      </td>
                      <td className="px-6 py-2.5 text-sm text-muted-foreground tabular-nums hidden md:table-cell">
                        {usedBy} {usedBy === 1 ? 'job' : 'jobs'}
                      </td>
                      <td className="px-6 py-2.5 text-sm text-muted-foreground tabular-nums hidden sm:table-cell">
                        {formatAbsolute(ep.createdAt)}
                      </td>
                      <td className="px-6 py-2.5" onClick={e => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label={`Open actions for ${ep.name}`}
                            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                          >
                            <MoreVertical className="w-4 h-4" aria-hidden />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="w-44">
                            <DropdownMenuItem onSelect={() => navigate(`/endpoints?edit=${ep.id}`)}>
                              <Pencil className="mr-2 h-4 w-4" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(ep)}>
                              <Trash2 className="mr-2 h-4 w-4" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )}

        {/* Bulk actions */}
        <BulkActionsBar
          count={selectedIds.size}
          itemLabel="endpoint"
          allSelected={allSelected}
          onSelectAll={() => setSelectedIds(new Set(filteredIds))}
          onClear={() => setSelectedIds(new Set())}
          actions={[
            {
              label: 'Delete',
              icon: <Trash2 className="w-3.5 h-3.5" />,
              onClick: () => toast.error('Bulk delete: select individual endpoints to delete.'),
              variant: 'destructive',
            },
          ]}
        />
      </div>

      {/* Dialogs */}
      <EndpointDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <EndpointDialog open={isEditDialogOpen} onClose={closeEditDialog} initial={editingEndpoint} />
      <DeleteDialog endpoint={deleting} onClose={() => setDeleting(null)} />
    </Shell>
  )
}
