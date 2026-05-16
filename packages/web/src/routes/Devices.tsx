import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Plus, RotateCw, Trash2, Monitor, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import Shell from '@/components/Shell'
import { useWsStore } from '@/lib/ws'
import { formatRelative } from '@/lib/format'
import * as api from '@/lib/api'

export default function Devices() {
  const queryClient = useQueryClient()
  const agentsOnline = useWsStore(s => s.agentsOnline)

  // ── Agent tokens ─────────────────────────────────────────────────────────────

  const { data: tokens = [] } = useQuery({
    queryKey: ['devices'],
    queryFn:  api.listDevices,
  })

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
              <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Created {formatRelative(t.createdAt)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.lastUsedAt ? `Last used ${formatRelative(t.lastUsedAt)}` : 'Never used'}
                    {' · '}
                    {t.expiresAt ? `Expires ${formatRelative(t.expiresAt)}` : 'No expiry'}
                  </p>
                </div>
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
                  onClick={() => deleteMutation.mutate(t.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

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
    </Shell>
  )
}
