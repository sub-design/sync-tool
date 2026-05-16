import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  HardDrive, Server, Terminal, Network, CloudUpload,
  Plus, Pencil, Trash2, Loader2, Lock,
} from 'lucide-react'
import { toast } from 'sonner'
import Shell from '@/components/Shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { endpointsApi } from '@/lib/endpoints'
import type { Endpoint, BackendType, SavedEndpointConfig } from '../types'

// ── Type metadata ─────────────────────────────────────────────────────────────

const TYPE_META: Record<BackendType, { label: string; icon: React.ReactNode; color: string }> = {
  local:  { label: 'Local',  icon: <HardDrive  size={14} />, color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  sftp:   { label: 'SFTP',   icon: <Terminal    size={14} />, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
  ftp:    { label: 'FTP',    icon: <Terminal    size={14} />, color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300' },
  ftps:   { label: 'FTPS',   icon: <Lock        size={14} />, color: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300' },
  s3:     { label: 'S3',     icon: <CloudUpload size={14} />, color: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300' },
  smb:    { label: 'SMB',    icon: <Network     size={14} />, color: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' },
  nfs:    { label: 'NFS',    icon: <Server      size={14} />, color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
}

function TypeBadge({ type }: { type: BackendType }) {
  const meta = TYPE_META[type]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.color}`}>
      {meta.icon} {meta.label}
    </span>
  )
}

function endpointSummary(ep: Endpoint): string {
  const { type, config } = ep
  if (type === 'local')  return config.path ?? '—'
  if (type === 's3')     return config.bucket ? `s3://${config.bucket}${config.remotePath ? `/${config.remotePath}` : ''}` : '—'
  if (type === 'smb')    return config.host ? `\\\\${config.host}\\${config.share ?? ''}` : '—'
  if (type === 'nfs')    return config.host ? `${config.host}:${config.remotePath ?? '/'}` : '—'
  return config.host ? `${config.host}:${config.port ?? ''}${config.remotePath ?? ''}` : '—'
}

// ── Endpoint form ─────────────────────────────────────────────────────────────

interface EndpointFormData {
  name: string
  type: BackendType
  config: SavedEndpointConfig
  deviceId: string
}

const EMPTY_FORM: EndpointFormData = {
  name: '', type: 'local', config: {}, deviceId: '',
}

function endpointToForm(ep: Endpoint): EndpointFormData {
  return { name: ep.name, type: ep.type, config: { ...ep.config }, deviceId: ep.deviceId ?? '' }
}

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

  if (type === 'local') {
    return field('ep-path', 'Path', 'path', { placeholder: '/mnt/backup or C:\\Backup' })
  }

  if (type === 's3') {
    return (
      <>
        {field('ep-bucket', 'Bucket *', 'bucket', { placeholder: 'my-backup-bucket' })}
        {field('ep-region', 'Region', 'region', { placeholder: 'us-east-1' })}
        {field('ep-prefix', 'Key prefix', 'remotePath', { placeholder: 'backups/prod' })}
        {field('ep-endpoint', 'Custom endpoint', 'endpoint', { placeholder: 'https://s3.example.com (MinIO, R2…)' })}
        {field('ep-access-key', 'Access key ID', 'accessKeyId', { placeholder: 'AKIA… (or use env vars on agent)' })}
        {field('ep-secret-key', 'Secret access key', 'secretAccessKey', { type: 'password', placeholder: '••••••••' })}
      </>
    )
  }

  if (type === 'smb') {
    return (
      <>
        {field('ep-host', 'Host *', 'host', { placeholder: 'nas.local or 192.168.1.5' })}
        {field('ep-share', 'Share', 'share', { placeholder: 'Backups' })}
        {field('ep-remote-path', 'Sub-path', 'remotePath', { placeholder: 'projects/2024' })}
        {field('ep-user', 'Username', 'username', { placeholder: 'DOMAIN\\user' })}
        {field('ep-pass', 'Password', 'password', { type: 'password', placeholder: '••••••••' })}
      </>
    )
  }

  if (type === 'nfs') {
    return (
      <>
        {field('ep-host', 'Host *', 'host', { placeholder: 'nas.local or 192.168.1.5' })}
        {field('ep-remote-path', 'Export path', 'remotePath', { placeholder: '/export/data' })}
      </>
    )
  }

  // sftp, ftp, ftps
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

function EndpointDialog({
  open, onClose, initial,
}: {
  open: boolean
  onClose: () => void
  initial?: Endpoint
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<EndpointFormData>(initial ? endpointToForm(initial) : EMPTY_FORM)
  const [error, setError] = useState('')

  const setConfig = (patch: Partial<SavedEndpointConfig>) =>
    setForm(f => ({ ...f, config: { ...f.config, ...patch } }))

  const mutation = useMutation({
    mutationFn: () => {
      const payload = { name: form.name.trim(), type: form.type, config: form.config, deviceId: form.deviceId || undefined }
      return initial
        ? endpointsApi.update(initial.id, payload)
        : endpointsApi.create(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['endpoints'] })
      toast.success(initial ? 'Endpoint updated' : 'Endpoint created')
      onClose()
    },
    onError: (err: Error) => setError(err.message),
  })

  const handleTypeChange = (type: BackendType) =>
    setForm(f => ({ ...f, type, config: {} }))

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit endpoint' : 'New endpoint'}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ep-name">Name *</Label>
            <Input
              id="ep-name"
              placeholder="Production NAS, S3 Backup…"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>

          {/* Type */}
          <div className="flex flex-col gap-1.5">
            <Label>Type *</Label>
            <Select value={form.type} onValueChange={v => handleTypeChange(v as BackendType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TYPE_META) as BackendType[]).map(t => (
                  <SelectItem key={t} value={t}>
                    <span className="flex items-center gap-2">
                      {TYPE_META[t].icon} {TYPE_META[t].label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Dynamic config fields */}
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

function DeleteDialog({
  endpoint, onClose,
}: {
  endpoint: Endpoint | null
  onClose: () => void
}) {
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
      // Try to parse 409 conflict body
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
  const [dialogOpen, setDialogOpen]   = useState(false)
  const [editing, setEditing]         = useState<Endpoint | undefined>()
  const [deleting, setDeleting]       = useState<Endpoint | null>(null)

  const { data: endpoints = [], isLoading } = useQuery({
    queryKey: ['endpoints'],
    queryFn:  endpointsApi.list,
  })

  const openCreate = () => { setEditing(undefined); setDialogOpen(true) }
  const openEdit   = (ep: Endpoint) => { setEditing(ep); setDialogOpen(true) }
  const closeDialog = () => { setDialogOpen(false); setEditing(undefined) }

  return (
    <Shell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Endpoints</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Saved connection configs — reference them in jobs instead of entering credentials each time.
          </p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus size={16} /> New endpoint
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
          <Loader2 className="animate-spin" size={16} /> Loading…
        </div>
      ) : endpoints.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          <Server size={32} className="mx-auto mb-3 opacity-30" />
          No endpoints yet.{' '}
          <button className="underline underline-offset-2 hover:text-foreground" onClick={openCreate}>
            Create your first endpoint
          </button>{' '}
          to reuse connection configs across jobs.
        </div>
      ) : (
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Type</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">Location</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">Created</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {endpoints.map((ep, i) => (
                <tr
                  key={ep.id}
                  className={`border-b border-border last:border-0 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? '' : 'bg-muted/10'}`}
                >
                  <td className="px-4 py-3 font-medium">{ep.name}</td>
                  <td className="px-4 py-3"><TypeBadge type={ep.type} /></td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs hidden sm:table-cell max-w-[240px] truncate">
                    {endpointSummary(ep)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    {new Date(ep.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => openEdit(ep)}>
                        <Pencil size={13} />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="size-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleting(ep)}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialogOpen && (
        <EndpointDialog open={dialogOpen} onClose={closeDialog} initial={editing} />
      )}
      <DeleteDialog endpoint={deleting} onClose={() => setDeleting(null)} />
    </Shell>
  )
}
