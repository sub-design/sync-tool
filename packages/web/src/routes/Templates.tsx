import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, Code2, Copy, FileText, Images, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import Shell from '@/components/Shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { JOB_PRESETS, type JobPreset, type JobPresetIcon } from '@/jobPresets'
import { formatRelative } from '@/lib/format'
import * as api from '@/lib/api'
import type { JobTemplate, JobTemplateDefaults } from '@/types'

const PRESET_ICONS: Record<JobPresetIcon, React.ElementType> = {
  images: Images,
  copy: Copy,
  sync: ArrowLeftRight,
  code: Code2,
}

export default function Templates() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<JobTemplate | null>(null)

  const { data: templates = [] } = useQuery({
    queryKey: ['job-templates'],
    queryFn: api.listJobTemplates,
  })

  const deleteTemplate = useMutation({
    mutationFn: api.deleteJobTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-templates'] })
      toast.success('Template deleted')
    },
    onError: () => toast.error('Failed to delete template'),
  })

  return (
    <Shell>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Job Templates</h1>
            <p className="text-sm text-muted-foreground mt-1">Saved job policies for creating consistent standalone jobs.</p>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New template
          </Button>
        </div>

        <div className="rounded-lg border overflow-hidden">
          {templates.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-muted-foreground">No saved templates yet.</p>
              <Button className="mt-4" size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                Create from preset
              </Button>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="text-left py-2.5 pl-4 pr-2 font-medium">Template</th>
                  <th className="text-left py-2.5 px-2 font-medium hidden md:table-cell">Mode</th>
                  <th className="text-left py-2.5 px-2 font-medium hidden lg:table-cell">Updated</th>
                  <th className="py-2.5 pl-2 pr-4" />
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="py-3 pl-4 pr-2">
                      <div className="flex items-center gap-2">
                        <FileText className="size-4 text-muted-foreground" />
                        <div>
                          <div className="text-sm font-medium">{template.name}</div>
                          {template.description && (
                            <div className="text-xs text-muted-foreground mt-0.5">{template.description}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-2 hidden md:table-cell">
                      <Badge variant="secondary">{templateMode(template)}</Badge>
                    </td>
                    <td className="py-3 px-2 text-xs text-muted-foreground hidden lg:table-cell">
                      {formatRelative(template.updatedAt)}
                    </td>
                    <td className="py-3 pl-2 pr-4">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setEditing(template)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm(`Delete template "${template.name}"?`)) deleteTemplate.mutate(template.id)
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <CreateTemplateDialog open={createOpen} onOpenChange={setCreateOpen} />
      {editing && (
        <EditTemplateDialog
          template={editing}
          onOpenChange={(open) => { if (!open) setEditing(null) }}
        />
      )}
    </Shell>
  )
}

function templateMode(template: JobTemplate): string {
  if (template.defaults.jobMode === 'import') return 'Import'
  if (template.defaults.direction === 'bidir') return 'Two-way sync'
  if (template.defaults.deletionPolicy === 'mirror') return 'Mirror backup'
  return 'Backup'
}

function CreateTemplateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const [selectedPresetId, setSelectedPresetId] = useState(JOB_PRESETS[0]?.id ?? '')
  const selectedPreset = useMemo(
    () => JOB_PRESETS.find((preset) => preset.id === selectedPresetId) ?? JOB_PRESETS[0],
    [selectedPresetId],
  )
  const [name, setName] = useState(selectedPreset?.name ?? '')
  const [description, setDescription] = useState(selectedPreset?.description ?? '')

  const createTemplate = useMutation({
    mutationFn: () => api.createJobTemplate({
      name: name.trim(),
      description: description.trim() || undefined,
      defaults: selectedPreset.defaults,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-templates'] })
      onOpenChange(false)
      toast.success('Template created')
    },
    onError: () => toast.error('Failed to create template'),
  })

  function selectPreset(preset: JobPreset) {
    setSelectedPresetId(preset.id)
    setName(preset.name)
    setDescription(preset.description)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogTitle>Create template from preset</DialogTitle>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {JOB_PRESETS.map((preset) => {
              const Icon = PRESET_ICONS[preset.icon]
              const active = preset.id === selectedPresetId
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => selectPreset(preset)}
                  className={[
                    'rounded-lg border p-4 text-left transition-colors hover:bg-accent',
                    active ? 'border-primary bg-secondary' : 'border-border',
                  ].join(' ')}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-background">
                      <Icon className="size-5" />
                    </div>
                    <div>
                      <h3 className="font-medium">{preset.name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{preset.description}</p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-name">Name</Label>
              <Input id="template-name" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-description">Description</Label>
              <Textarea id="template-description" rows={3} value={description} onChange={e => setDescription(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={!name.trim() || createTemplate.isPending} onClick={() => createTemplate.mutate()}>
            Create template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditTemplateDialog({ template, onOpenChange }: { template: JobTemplate; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()

  // Metadata
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description ?? '')

  // Policy defaults
  const d = template.defaults
  const [jobMode, setJobMode] = useState<string>(d.jobMode ?? 'sync')
  const [direction, setDirection] = useState<string>(d.direction ?? 'ltr')
  const [transferMode, setTransferMode] = useState<string>(d.transferMode ?? 'auto')
  const [deletionPolicy, setDeletionPolicy] = useState<string>(d.deletionPolicy ?? 'backup')
  const [conflictStrategy, setConflictStrategy] = useState<string>(d.conflictStrategy ?? 'newer-wins')
  const [destinationLayout, setDestinationLayout] = useState<string>(d.destinationLayout ?? 'byCaptureDate')
  const [dateSource, setDateSource] = useState<string>(d.dateSource ?? 'exifThenMtime')

  // Propagation state
  const [showApplyPrompt, setShowApplyPrompt] = useState(false)
  const [derivedCount, setDerivedCount] = useState(0)
  const [isApplying, setIsApplying] = useState(false)

  const updateTemplate = useMutation({
    mutationFn: () => {
      const defaults: JobTemplateDefaults = {
        ...template.defaults,
        jobMode: jobMode as JobTemplateDefaults['jobMode'],
        direction: direction as JobTemplateDefaults['direction'],
        transferMode: transferMode as JobTemplateDefaults['transferMode'],
        deletionPolicy: deletionPolicy as JobTemplateDefaults['deletionPolicy'],
        conflictStrategy: conflictStrategy as JobTemplateDefaults['conflictStrategy'],
        ...(jobMode === 'import' ? {
          destinationLayout: destinationLayout as JobTemplateDefaults['destinationLayout'],
          dateSource: dateSource as JobTemplateDefaults['dateSource'],
        } : {}),
      }
      return api.updateJobTemplate(template.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        defaults,
      })
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['job-templates'] })
      toast.success('Template updated')
      const result = await api.getDerivedJobs(template.id)
      if (result.count > 0) {
        setDerivedCount(result.count)
        setShowApplyPrompt(true)
      } else {
        onOpenChange(false)
      }
    },
    onError: () => toast.error('Failed to update template'),
  })

  async function handleApply() {
    setIsApplying(true)
    try {
      const result = await api.applyJobTemplate(template.id)
      toast.success(`Updated ${result.updatedCount} job${result.updatedCount !== 1 ? 's' : ''}`)
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    } catch {
      toast.error('Failed to apply template to jobs')
    } finally {
      setIsApplying(false)
      onOpenChange(false)
    }
  }

  if (showApplyPrompt) {
    return (
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Apply to derived jobs?</DialogTitle>
          <p className="text-sm text-muted-foreground">
            This template is used by <strong>{derivedCount} job{derivedCount !== 1 ? 's' : ''}</strong>. Sync
            settings (direction, mode, deletion policy, etc.) will be updated. Source paths and device
            assignments will not change.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isApplying}>
              Skip
            </Button>
            <Button type="button" onClick={handleApply} disabled={isApplying}>
              {isApplying ? 'Applying…' : `Apply to ${derivedCount} job${derivedCount !== 1 ? 's' : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Edit template</DialogTitle>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-template-name">Name</Label>
              <Input id="edit-template-name" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-template-description">Description</Label>
              <Textarea id="edit-template-description" rows={3} value={description} onChange={e => setDescription(e.target.value)} />
            </div>
          </div>

          <div className="border-t pt-3 grid gap-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sync settings</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Mode</Label>
                <Select value={jobMode} onValueChange={setJobMode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sync">Sync</SelectItem>
                    <SelectItem value="import">Import</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Direction</Label>
                <Select value={direction} onValueChange={setDirection}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ltr">Source → Destination</SelectItem>
                    <SelectItem value="rtl">Destination → Source</SelectItem>
                    <SelectItem value="bidir">Both ways</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Transfer mode</Label>
                <Select value={transferMode} onValueChange={setTransferMode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="full">Full copy</SelectItem>
                    <SelectItem value="delta">Delta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Deletion policy</Label>
                <Select value={deletionPolicy} onValueChange={setDeletionPolicy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="backup">Backup deleted files</SelectItem>
                    <SelectItem value="backup-with-deletes">Backup then delete</SelectItem>
                    <SelectItem value="mirror">Mirror (delete)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {jobMode === 'sync' && (
                <div className="flex flex-col gap-1.5">
                  <Label>Conflict strategy</Label>
                  <Select value={conflictStrategy} onValueChange={setConflictStrategy}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newer-wins">Newer wins</SelectItem>
                      <SelectItem value="skip">Skip</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {jobMode === 'import' && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label>Destination layout</Label>
                    <Select value={destinationLayout} onValueChange={setDestinationLayout}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="byCaptureDate">By capture date</SelectItem>
                        <SelectItem value="sameTree">Same tree</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Date source</Label>
                    <Select value={dateSource} onValueChange={setDateSource}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="exifThenMtime">EXIF, then file date</SelectItem>
                        <SelectItem value="mtime">File date only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={!name.trim() || updateTemplate.isPending} onClick={() => updateTemplate.mutate()}>
            {updateTemplate.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
