import { useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FolderOpen, HardDrive, Layers, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import Shell from '@/components/Shell'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { RuleBuilder, type RuleCondition, buildRuleQuery, parseRuleQuery } from '@/components/RuleBuilder'
import { RuleLivePreview } from '@/components/RuleLivePreview'
import { formatRelative } from '@/lib/format'
import * as api from '@/lib/api'
import type { Collection, AgentToken, JobTemplate, CollectionTemplateLink, Job } from '@/types'

export default function CollectionDetail() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [editing, setEditing] = useState(false)
  const [applying, setApplying] = useState(false)

  const { data: collection, isLoading, isError } = useQuery({
    queryKey: ['collection', id],
    queryFn: () => api.getCollection(id),
    enabled: Boolean(id),
  })

  const { data: applied = [] } = useQuery<CollectionTemplateLink[]>({
    queryKey: ['collection-templates', id],
    queryFn: () => api.listAppliedTemplates(id),
    enabled: Boolean(id),
  })

  const { data: devices = [] } = useQuery<AgentToken[]>({
    queryKey: ['devices'],
    queryFn: api.listDevices,
  })

  const { data: allJobs = [] } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: api.listJobs,
  })

  const derivedJobs = useMemo(
    () => allJobs.filter((j) => j.collectionId === id),
    [allJobs, id],
  )

  const memberDevices = useMemo(
    () => collection?.type === 'static'
      ? devices.filter((d) => (collection.deviceIds ?? []).includes(d.id))
      : [], // Dynamic collections don't have deviceIds, membership is computed by rules
    [devices, collection],
  )

  const deleteCollection = useMutation({
    mutationFn: () => api.deleteCollection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] })
      toast.success('Collection deleted')
      navigate('/collections')
    },
    onError: () => toast.error('Failed to delete collection'),
  })

  const unapply = useMutation({
    mutationFn: (templateId: string) => api.unapplyTemplateFromCollection(id, templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collection-templates', id] })
      toast.success('Template unapplied (existing jobs kept)')
    },
    onError: () => toast.error('Failed to unapply'),
  })

  if (isLoading) {
    return <Shell><p className="text-sm text-muted-foreground">Loading…</p></Shell>
  }
  if (isError || !collection) {
    return (
      <Shell>
        <div className="space-y-3">
          <Link to="/collections" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Collections
          </Link>
          <p className="text-sm">Collection not found.</p>
        </div>
      </Shell>
    )
  }

  const isEmpty = applied.length === 0

  return (
    <Shell>
      <div className="space-y-6">
        {/* ── Header ── */}
        <div className="space-y-2">
          <Link
            to="/collections"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Collections
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted/30">
                <FolderOpen className="size-5 text-muted-foreground" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight">{collection.name}</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {collection.type === 'static' ? 'Static' : 'Dynamic'} · {collection.type === 'static' ? `${collection.deviceIds?.length ?? 0} device${(collection.deviceIds?.length ?? 0) !== 1 ? 's' : ''}` : 'Rule-based membership'} · {applied.length} template{applied.length !== 1 ? 's' : ''} applied
                </p>
                {collection.description && (
                  <p className="text-sm text-muted-foreground mt-1">{collection.description}</p>
                )}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                onClick={() => setApplying(true)}
                disabled={collection.deviceIds.length === 0}
                title={collection.deviceIds.length === 0 ? 'Add devices first' : 'Apply a template'}
              >
                <Send className="size-3.5" />
                Apply Template
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" />
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  if (confirm(`Delete collection "${collection.name}"?`)) deleteCollection.mutate()
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* ── Applied Templates ── */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Applied Templates
            </h2>
            {!isEmpty && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setApplying(true)}
                disabled={collection.deviceIds.length === 0}
              >
                <Plus className="size-3.5" /> Apply another
              </Button>
            )}
          </div>
          {isEmpty ? (
            <div className="rounded-lg border border-dashed py-10 px-6 text-center">
              <p className="text-sm font-medium">No templates applied yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                {collection.deviceIds.length === 0
                  ? 'Add devices to this collection first, then apply a template to start protecting them.'
                  : `Apply a template to create jobs on all ${collection.deviceIds.length} device${collection.deviceIds.length !== 1 ? 's' : ''} at once.`}
              </p>
              {collection.deviceIds.length > 0 && (
                <Button className="mt-4" size="sm" onClick={() => setApplying(true)}>
                  <Send className="size-3.5" /> Apply Template
                </Button>
              )}
            </div>
          ) : (
            <ul className="rounded-lg border divide-y">
              {applied.map((link) => (
                <li key={link.id} className="flex items-center gap-3 px-4 py-3">
                  <Layers className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{link.templateName ?? link.templateId}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate font-mono">
                      {link.source} → {link.destination}
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {link.jobCount} job{link.jobCount !== 1 ? 's' : ''}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => unapply.mutate(link.templateId)}
                    disabled={unapply.isPending}
                  >
                    Unapply
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Devices ── */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {collection.type === 'static' ? `Devices (${memberDevices.length})` : 'Membership'}
            </h2>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" /> Manage
            </Button>
          </div>
          {collection.type === 'static' ? (
            memberDevices.length === 0 ? (
              <div className="rounded-lg border border-dashed py-8 px-6 text-center">
                <p className="text-sm text-muted-foreground">No devices in this collection.</p>
                <Button className="mt-3" size="sm" variant="outline" onClick={() => setEditing(true)}>
                  Add devices
                </Button>
              </div>
            ) : (
              <ul className="rounded-lg border divide-y">
                {memberDevices.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <HardDrive className="size-4 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate">{d.name}</span>
                    <span className="text-xs text-muted-foreground font-mono">{d.id.slice(0, 8)}</span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="text-sm">
                <span className="font-medium">Rule:</span> {collection.membershipRule?.description || 'Custom rule'}
              </div>
              <div className="text-xs text-muted-foreground font-mono bg-background p-2 rounded">
                {collection.membershipRule?.query || 'No rule defined'}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Preview</Label>
                <RuleLivePreview conditions={collection.membershipRule ? parseRuleQuery(collection.membershipRule.query) : []} membershipRule={collection.membershipRule} />
              </div>
            </div>
          )}
        </section>

        {/* ── Derived Jobs ── */}
        {derivedJobs.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Jobs from this collection ({derivedJobs.length})
            </h2>
            <ul className="rounded-lg border divide-y">
              {derivedJobs.map((job) => (
                <li key={job.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <Link to={`/jobs/${job.id}`} className="flex-1 truncate hover:underline">
                    {job.name}
                  </Link>
                  <Badge variant="outline" className="shrink-0 text-xs capitalize">{job.status}</Badge>
                  {job.lastRun && (
                    <span className="text-xs text-muted-foreground shrink-0">{formatRelative(job.lastRun)}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {editing && (
        <EditCollectionDialog
          collection={collection}
          derivedJobs={derivedJobs}
          onOpenChange={(open) => { if (!open) setEditing(false) }}
        />
      )}
      {applying && (
        <ApplyTemplateDialog
          collection={collection}
          onOpenChange={(open) => { if (!open) setApplying(false) }}
        />
      )}
    </Shell>
  )
}

function DeviceCheckboxList({
  selected,
  onChange,
}: {
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const { data: devices = [] } = useQuery<AgentToken[]>({
    queryKey: ['devices'],
    queryFn: api.listDevices,
  })

  if (devices.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">No devices registered yet.</p>
  }

  return (
    <div className="max-h-48 overflow-y-auto rounded-md border p-2 space-y-1">
      {devices.map((device) => {
        const checked = selected.includes(device.id)
        return (
          <label key={device.id} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted/50 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => {
                onChange(checked
                  ? selected.filter((id) => id !== device.id)
                  : [...selected, device.id])
              }}
              className="rounded border-border"
            />
            <span>{device.name}</span>
          </label>
        )
      })}
    </div>
  )
}

function EditCollectionDialog({
  collection,
  derivedJobs,
  onOpenChange,
}: {
  collection: Collection
  derivedJobs: Job[]
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(collection.name)
  const [description, setDescription] = useState(collection.description ?? '')
  const [deviceIds, setDeviceIds] = useState<string[]>(collection.deviceIds ?? [])
  const [ruleConditions, setRuleConditions] = useState<RuleCondition[]>(
    collection.membershipRule ? parseRuleQuery(collection.membershipRule.query) : []
  )
  const [step, setStep] = useState<'edit' | 'orphan-confirm'>('edit')

  // Compute removed devices and their orphaned jobs (only for static collections)
  const removedDeviceIds = useMemo(() => {
    if (collection.type !== 'static') return []
    const next = new Set(deviceIds)
    return (collection.deviceIds ?? []).filter((id) => !next.has(id))
  }, [collection.deviceIds, deviceIds, collection.type])

  const addedDeviceCount = useMemo(() => {
    if (collection.type !== 'static') return 0
    const prev = new Set(collection.deviceIds ?? [])
    return deviceIds.filter((id) => !prev.has(id)).length
  }, [collection.deviceIds, deviceIds, collection.type])

  const orphanedJobs = useMemo(
    () => derivedJobs.filter((j) => j.sourceDeviceId && removedDeviceIds.includes(j.sourceDeviceId)),
    [derivedJobs, removedDeviceIds],
  )

  const save = useMutation({
    mutationFn: (deleteOrphanedJobs: boolean) => api.updateCollection(collection.id, {
      name: name.trim(),
      description: description.trim() || undefined,
      type: collection.type,
      deviceIds: collection.type === 'static' ? deviceIds : undefined,
      membershipRule: collection.type === 'dynamic' ? {
        query: buildRuleQuery(ruleConditions),
        description: 'Custom rule',
      } : undefined,
      deleteOrphanedJobs,
    }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['collection', collection.id] })
      queryClient.invalidateQueries({ queryKey: ['collections'] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      const parts: string[] = ['Collection updated']
      if (result.autoCreated)    parts.push(`created ${result.autoCreated} job${result.autoCreated !== 1 ? 's' : ''}`)
      if (result.deletedOrphans) parts.push(`deleted ${result.deletedOrphans} job${result.deletedOrphans !== 1 ? 's' : ''}`)
      if (result.keptOrphans)    parts.push(`${result.keptOrphans} job${result.keptOrphans !== 1 ? 's' : ''} kept (orphaned)`)
      toast.success(parts.join(' · '))
      onOpenChange(false)
    },
    onError: () => toast.error('Failed to update collection'),
  })

  function handleSaveClick() {
    if (orphanedJobs.length > 0) {
      setStep('orphan-confirm')
    } else {
      save.mutate(false)
    }
  }

  if (step === 'orphan-confirm') {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>What about the existing jobs?</DialogTitle>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Removing {removedDeviceIds.length} device{removedDeviceIds.length !== 1 ? 's' : ''} from this collection will leave{' '}
              <strong>{orphanedJobs.length} job{orphanedJobs.length !== 1 ? 's' : ''}</strong> without a parent collection.
            </p>
            <ul className="max-h-40 overflow-y-auto rounded-md border bg-muted/30 p-2 space-y-1 text-xs font-mono">
              {orphanedJobs.map((j) => (
                <li key={j.id} className="truncate">{j.name}</li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Keeping them means they'll continue running independently. Deleting them removes the jobs and their run history.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setStep('edit')} disabled={save.isPending}>
              Back
            </Button>
            <Button type="button" variant="outline" onClick={() => save.mutate(false)} disabled={save.isPending}>
              Keep them
            </Button>
            <Button type="button" variant="destructive" onClick={() => save.mutate(true)} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : `Delete ${orphanedJobs.length} job${orphanedJobs.length !== 1 ? 's' : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogTitle>Edit collection</DialogTitle>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="col-edit-name">Name</Label>
              <Input id="col-edit-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="col-edit-description">Description</Label>
              <Textarea id="col-edit-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>

          {collection.type === 'static' ? (
            <div className="flex flex-col gap-1.5">
              <Label>Devices</Label>
              <DeviceCheckboxList selected={deviceIds} onChange={setDeviceIds} />
              <p className="text-xs text-muted-foreground">{deviceIds.length} selected</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Membership rules</Label>
                <RuleBuilder conditions={ruleConditions} onChange={setRuleConditions} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Preview</Label>
                <RuleLivePreview conditions={ruleConditions} membershipRule={collection.membershipRule} />
              </div>
            </div>
          )}

          {collection.type === 'static' && (addedDeviceCount > 0 || orphanedJobs.length > 0) && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
              <div className="font-medium text-sm mb-1">Impact on existing jobs</div>
              {addedDeviceCount > 0 && (
                <div className="text-muted-foreground">
                  ✓ <strong>{addedDeviceCount}</strong> new device{addedDeviceCount !== 1 ? 's' : ''} will get jobs from all applied templates.
                </div>
              )}
              {orphanedJobs.length > 0 && (
                <div className="text-muted-foreground">
                  ⚠ <strong>{orphanedJobs.length}</strong> existing job{orphanedJobs.length !== 1 ? 's' : ''} will be left without a parent (you'll choose to delete or keep on save).
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={!name.trim() || save.isPending} onClick={handleSaveClick}>
            {save.isPending ? 'Saving…' : orphanedJobs.length > 0 ? 'Continue…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ApplyTemplateDialog({
  collection,
  onOpenChange,
}: {
  collection: Collection
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()

  const { data: templates = [] } = useQuery<JobTemplate[]>({
    queryKey: ['job-templates'],
    queryFn: api.listJobTemplates,
  })

  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? '')
  const selected = useMemo(() => templates.find((t) => t.id === templateId), [templates, templateId])

  const [source, setSource] = useState('')
  const [destination, setDestination] = useState('')
  const [touched, setTouched] = useState(false)

  const defaultSource      = selected?.defaults.source ?? ''
  const defaultDestination = selected?.defaults.destination ?? ''
  const effectiveSource      = touched ? source      : defaultSource
  const effectiveDestination = touched ? destination : defaultDestination

  const { data: preview } = useQuery({
    queryKey: ['apply-preview', collection.id, templateId],
    queryFn: () => api.previewApplyTemplate(collection.id, templateId),
    enabled: Boolean(templateId),
  })

  const apply = useMutation({
    mutationFn: () => api.applyTemplateToCollection(collection.id, {
      templateId,
      source: effectiveSource,
      destination: effectiveDestination,
    }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['collection-templates', collection.id] })
      queryClient.invalidateQueries({ queryKey: ['apply-preview', collection.id, templateId] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      toast.success(`Created ${result.created} job${result.created !== 1 ? 's' : ''}` + (result.skipped ? `, skipped ${result.skipped}` : ''))
      onOpenChange(false)
    },
    onError: () => toast.error('Failed to apply template'),
  })

  const canApply = Boolean(templateId) && effectiveSource.trim() !== '' && effectiveDestination.trim() !== '' && !apply.isPending

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogTitle>Apply template to {collection.name}</DialogTitle>
        <div className="grid gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Template</Label>
            <Select value={templateId} onValueChange={(v) => { setTemplateId(v); setTouched(false) }}>
              <SelectTrigger><SelectValue placeholder="Pick a template" /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {templates.length === 0 && (
              <p className="text-xs text-muted-foreground">No saved templates yet. Create one on the Templates page.</p>
            )}
          </div>

          {selected && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="apply-source">Source path</Label>
                  <Input
                    id="apply-source"
                    value={effectiveSource}
                    onChange={(e) => { setSource(e.target.value); setTouched(true) }}
                    placeholder="e.g. /Users/me/Documents"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="apply-destination">Destination path</Label>
                  <Input
                    id="apply-destination"
                    value={effectiveDestination}
                    onChange={(e) => { setDestination(e.target.value); setTouched(true) }}
                    placeholder="e.g. s3://backup/{DeviceName}"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Variables: <code>{'{DeviceName}'}</code> resolves to each device's name.
              </p>

              {preview && (
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <div className="font-medium mb-1">What will happen</div>
                  <ul className="text-xs text-muted-foreground space-y-0.5">
                    <li>✓ Create <strong>{preview.wouldCreate}</strong> new job{preview.wouldCreate !== 1 ? 's' : ''}</li>
                    {preview.alreadyExist > 0 && (
                      <li>• Skip <strong>{preview.alreadyExist}</strong> device{preview.alreadyExist !== 1 ? 's' : ''} (job already exists)</li>
                    )}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={!canApply} onClick={() => apply.mutate()}>
            {apply.isPending
              ? 'Applying…'
              : preview
                ? `Apply to ${preview.wouldCreate} device${preview.wouldCreate !== 1 ? 's' : ''}`
                : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
