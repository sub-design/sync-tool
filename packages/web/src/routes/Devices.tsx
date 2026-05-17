import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Plus, RotateCw, Trash2, Monitor, WifiOff, Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import Shell from '@/components/Shell'
import { BulkActionsBar } from '@/components/BulkActionsBar'
import { useWsStore } from '@/lib/ws'
import { formatRelative } from '@/lib/format'
import * as api from '@/lib/api'

type RotatedToken = {
  id: string
  oldId?: string
  name?: string
  token: string
  expiresAt?: number
}

export default function Devices() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const agentsOnline = useWsStore(s => s.agentsOnline)
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(new Set())
  const [rotatedTokens, setRotatedTokens] = useState<RotatedToken[]>([])

  // ── Agent tokens ─────────────────────────────────────────────────────────────

  const { data: tokens = [] } = useQuery({
    queryKey: ['devices'],
    queryFn:  api.listDevices,
  })

  useEffect(() => {
    setSelectedDeviceIds((current) => {
      const validIds = new Set(tokens.map((token) => token.id))
      const next = new Set([...current].filter((id) => validIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [tokens])

  const deleteMutation = useMutation({
    mutationFn: api.deleteDevice,
    onSuccess:  () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      toast.success('Token revoked')
    },
    onError: () => toast.error('Failed to revoke token'),
  })

  const rotateMutation = useMutation({
    mutationFn: (id: string) => api.rotateDevice(id),
    onSuccess: (result) => {
      setNewToken(result.token)
      setCreateOpen(true)
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      toast.success('Token rotated — copy the new token')
    },
    onError: () => toast.error('Failed to rotate token'),
  })

  // ── Batch mutations ───────────────────────────────────────────────────────────

  const batchDeleteMutation = useMutation({
    mutationFn: api.batchDeleteDevices,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      setSelectedDeviceIds(new Set())
      toast.success(`Revoked ${result.successful} tokens${result.failed > 0 ? ` (${result.failed} failed)` : ''}`)
    },
    onError: () => toast.error('Failed to revoke some tokens'),
  })

  const batchRotateMutation = useMutation({
    mutationFn: (ids: string[]) => api.batchRotateDevices(ids),
    onSuccess: (result) => {
      const generated = result.results.filter((entry): entry is RotatedToken & { ok: true } =>
        entry.ok && typeof entry.token === 'string',
      )
      if (generated.length > 0) setRotatedTokens(generated)
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      setSelectedDeviceIds(new Set())
      toast.success(`Rotated ${generated.length} token${generated.length !== 1 ? 's' : ''}${result.failed > 0 ? ` (${result.failed} failed)` : ''}`)
    },
    onError: () => toast.error('Failed to rotate some tokens'),
  })

  // ── Create token dialog ───────────────────────────────────────────────────────

  const [createOpen, setCreateOpen]     = useState(false)
  const [tokenName,  setTokenName]      = useState('')
  const [newToken,   setNewToken]       = useState<string | null>(null)
  const [copied,     setCopied]         = useState(false)

  const createMutation = useMutation({
    mutationFn: (name: string) => api.createDevice(name),
    onSuccess: (result) => {
      setNewToken(result.token)
      setTokenName('')
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      toast.success('Token created — copy it before closing')
    },
    onError: () => toast.error('Failed to create token'),
  })

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (tokenName.trim()) createMutation.mutate(tokenName.trim())
  }

  function copyToken() {
    if (!newToken) return
    navigator.clipboard.writeText(newToken)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function closeCreateDialog() {
    setCreateOpen(false)
    setNewToken(null)
    setTokenName('')
    setCopied(false)
  }

  // ── Selection handlers ───────────────────────────────────────────────────────

  const allSelected = tokens.length > 0 && tokens.every(t => selectedDeviceIds.has(t.id))
  const selectedTokens = useMemo(
    () => tokens.filter(t => selectedDeviceIds.has(t.id)),
    [tokens, selectedDeviceIds],
  )

  function handleSelectAll(checked: boolean) {
    if (checked) {
      setSelectedDeviceIds(new Set(tokens.map(t => t.id)))
    } else {
      setSelectedDeviceIds(new Set())
    }
  }

  function handleSelectDevice(id: string, checked: boolean) {
    const next = new Set(selectedDeviceIds)
    if (checked) {
      next.add(id)
    } else {
      next.delete(id)
    }
    setSelectedDeviceIds(next)
  }

  function handleExport() {
    const csv = [
      'Name,ID,Created At,Last Used At,Expires At',
      ...selectedTokens.map(t =>
        [t.name, t.id, new Date(t.createdAt).toISOString(), t.lastUsedAt ? new Date(t.lastUsedAt).toISOString() : '', t.expiresAt ? new Date(t.expiresAt).toISOString() : ''].map(csvCell).join(',')
      )
    ].join('\n')

    downloadCsv('devices.csv', csv)
    toast.success('Exported devices to CSV')
  }

  function handleBatchDelete() {
    const count = selectedDeviceIds.size
    if (count === 0) return
    if (!window.confirm(`Revoke ${count} selected token${count !== 1 ? 's' : ''}? Connected agents using them will be disconnected on their next auth check.`)) return
    batchDeleteMutation.mutate(Array.from(selectedDeviceIds))
  }

  function handleBatchRotate() {
    const count = selectedDeviceIds.size
    if (count === 0) return
    if (!window.confirm(`Rotate ${count} selected token${count !== 1 ? 's' : ''}? Old tokens will be revoked immediately.`)) return
    batchRotateMutation.mutate(Array.from(selectedDeviceIds))
  }

  function exportRotatedTokens() {
    const csv = [
      'Name,New Token ID,Old Token ID,Token,Expires At',
      ...rotatedTokens.map(t =>
        [t.name ?? '', t.id, t.oldId ?? '', t.token, t.expiresAt ? new Date(t.expiresAt).toISOString() : ''].map(csvCell).join(',')
      )
    ].join('\n')
    downloadCsv('rotated-device-tokens.csv', csv)
    toast.success('Exported rotated tokens to CSV')
  }

  function copyRotatedTokens() {
    navigator.clipboard.writeText(rotatedTokens.map(t => `${t.name ?? t.id}: ${t.token}`).join('\n'))
    toast.success('Copied rotated tokens')
  }

  function downloadCsv(filename: string, csv: string) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Shell>
      {/* ── Online agents ────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Online Now
        </h2>

        {agentsOnline.size === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
            <WifiOff className="size-4 shrink-0" />
            No agents connected
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {[...agentsOnline.entries()].map(([deviceId, hostname]) => (
              <div
                key={deviceId}
                className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
              >
                <span className="inline-block size-2 rounded-full bg-green-500 shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium truncate">{hostname}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate">{deviceId}</p>
                </div>
                <Monitor className="size-4 text-muted-foreground ml-auto shrink-0" />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Agent tokens ─────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Agent Tokens
          </h2>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" />
            New Token
          </Button>
        </div>

        {tokens.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
            No tokens yet. Create one to connect an agent.
          </div>
        ) : (
          <div className="rounded-lg border divide-y">
            {tokens.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
              >
                <Checkbox
                  checked={selectedDeviceIds.has(t.id)}
                  onCheckedChange={(checked) => handleSelectDevice(t.id, checked === true)}
                  aria-label={`Select ${t.name}`}
                />
                <button
                  type="button"
                  onClick={() => navigate(`/devices/${t.id}`)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Created {formatRelative(t.createdAt)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.lastUsedAt ? `Last used ${formatRelative(t.lastUsedAt)}` : 'Never used'}
                    {' · '}
                    {t.expiresAt ? `Expires ${formatRelative(t.expiresAt)}` : 'No expiry'}
                  </p>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => rotateMutation.mutate(t.id)}
                  title="Rotate token"
                >
                  <RotateCw className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => {
                    if (window.confirm(`Revoke token "${t.name}"?`)) deleteMutation.mutate(t.id)
                  }}
                  title="Revoke token"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Bulk actions bar ───────────────────────────────────────────────────── */}
      <BulkActionsBar
        count={selectedDeviceIds.size}
        itemLabel="device"
        allSelected={allSelected}
        onSelectAll={() => handleSelectAll(!allSelected)}
        onClear={() => setSelectedDeviceIds(new Set())}
        meta={<span>{selectedTokens.length} of {tokens.length}</span>}
        actions={[
          {
            label: 'Rotate Tokens',
            icon: <RotateCw className="w-3.5 h-3.5" />,
            onClick: handleBatchRotate,
            disabled: batchRotateMutation.isPending,
          },
          {
            label: 'Export',
            icon: <Download className="w-3.5 h-3.5" />,
            onClick: handleExport,
          },
          {
            label: 'Delete',
            icon: <Trash2 className="w-3.5 h-3.5" />,
            onClick: handleBatchDelete,
            variant: 'destructive',
            disabled: batchDeleteMutation.isPending,
          },
        ]}
      />

      {/* ── Create token dialog ───────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) closeCreateDialog() }}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>New Agent Token</DialogTitle>

          {newToken ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Copy this token now — it won't be shown again.
              </p>
              <div className="flex gap-2">
                <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono break-all select-all">
                  {newToken}
                </code>
                <Button variant="outline" size="icon" onClick={copyToken}>
                  <Copy className="size-4" />
                </Button>
              </div>
              {copied && <p className="text-xs text-green-600">Copied to clipboard.</p>}
              <p className="text-xs text-muted-foreground">
                Paste this as <code className="font-mono">AGENT_TOKEN</code> in the app or agent env.
              </p>
              <div className="flex justify-end">
                <Button onClick={closeCreateDialog}>Done</Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="tokenName">Token name</Label>
                <Input
                  id="tokenName"
                  placeholder="e.g. MacBook Pro, Home NAS"
                  value={tokenName}
                  onChange={e => setTokenName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeCreateDialog}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!tokenName.trim() || createMutation.isPending}
                >
                  {createMutation.isPending ? 'Creating…' : 'Create'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={rotatedTokens.length > 0} onOpenChange={(open) => { if (!open) setRotatedTokens([]) }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogTitle>Rotated Agent Tokens</DialogTitle>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Copy these tokens now. They will not be shown again.
            </p>
            <div className="max-h-72 overflow-y-auto rounded-md border divide-y">
              {rotatedTokens.map((entry) => (
                <div key={entry.id} className="grid gap-2 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{entry.name ?? entry.id}</span>
                    {entry.expiresAt && (
                      <span className="text-xs text-muted-foreground">Expires {formatRelative(entry.expiresAt)}</span>
                    )}
                  </div>
                  <code className="rounded bg-muted px-2 py-1.5 text-xs font-mono break-all select-all">
                    {entry.token}
                  </code>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={copyRotatedTokens}>
                <Copy className="size-4" />
                Copy all
              </Button>
              <Button type="button" variant="outline" onClick={exportRotatedTokens}>
                <Download className="size-4" />
                Export CSV
              </Button>
              <Button type="button" onClick={() => setRotatedTokens([])}>
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Shell>
  )
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}
