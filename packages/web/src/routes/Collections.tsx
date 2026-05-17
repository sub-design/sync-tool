import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderOpen, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import Shell from '@/components/Shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { RuleBuilder, type RuleCondition, buildRuleQuery } from '@/components/RuleBuilder'
import { RuleLivePreview } from '@/components/RuleLivePreview'
import { formatRelative } from '@/lib/format'
import * as api from '@/lib/api'
import type { AgentToken, CollectionType } from '@/types'

export default function Collections() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: api.listCollections,
  })

  const deleteCollection = useMutation({
    mutationFn: api.deleteCollection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] })
      toast.success('Collection deleted')
    },
    onError: () => toast.error('Failed to delete collection'),
  })

  return (
    <Shell>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Device Collections</h1>
            <p className="text-sm text-muted-foreground mt-1">Named groups of devices for applying templates at scale.</p>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New collection
          </Button>
        </div>

        <div className="rounded-lg border overflow-hidden">
          {collections.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-muted-foreground">No collections yet.</p>
              <Button className="mt-4" size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                Create collection
              </Button>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="text-left py-2.5 pl-4 pr-2 font-medium">Collection</th>
                  <th className="text-left py-2.5 px-2 font-medium hidden sm:table-cell">Devices</th>
                  <th className="text-left py-2.5 px-2 font-medium hidden lg:table-cell">Updated</th>
                  <th className="py-2.5 pl-2 pr-4" />
                </tr>
              </thead>
              <tbody>
                {collections.map((col) => (
                  <tr key={col.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="py-3 pl-4 pr-2">
                      <Link to={`/collections/${col.id}`} className="flex items-center gap-2 group">
                        <FolderOpen className="size-4 text-muted-foreground" />
                        <div>
                          <div className="text-sm font-medium group-hover:underline">{col.name}</div>
                          {col.description && (
                            <div className="text-xs text-muted-foreground mt-0.5">{col.description}</div>
                          )}
                        </div>
                      </Link>
                    </td>
                    <td className="py-3 px-2 text-sm text-muted-foreground hidden sm:table-cell">
                      {col.deviceIds.length} {col.deviceIds.length === 1 ? 'device' : 'devices'}
                    </td>
                    <td className="py-3 px-2 text-xs text-muted-foreground hidden lg:table-cell">
                      {formatRelative(col.updatedAt)}
                    </td>
                    <td className="py-3 pl-2 pr-4">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm(`Delete collection "${col.name}"?`)) deleteCollection.mutate(col.id)
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

      <CreateCollectionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
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

function CreateCollectionDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<CollectionType>('static')
  const [deviceIds, setDeviceIds] = useState<string[]>([])
  const [ruleConditions, setRuleConditions] = useState<RuleCondition[]>([])

  const create = useMutation({
    mutationFn: () => api.createCollection({
      name: name.trim(),
      description: description.trim() || undefined,
      type,
      deviceIds: type === 'static' ? deviceIds : undefined,
      membershipRule: type === 'dynamic' ? {
        query: buildRuleQuery(ruleConditions),
        description: 'Custom rule',
      } : undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] })
      onOpenChange(false)
      setName(''); setDescription(''); setDeviceIds([]); setRuleConditions([]); setType('static')
      toast.success('Collection created')
    },
    onError: () => toast.error('Failed to create collection'),
  })

  const isValid = name.trim() && (
    type === 'static' ? deviceIds.length > 0 : ruleConditions.length > 0
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogTitle>New collection</DialogTitle>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="col-name">Name</Label>
              <Input
                id="col-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sales Laptops"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="col-description">Description</Label>
              <Textarea
                id="col-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Membership type</Label>
            <RadioGroup value={type} onValueChange={(value) => setType(value as CollectionType)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="static" id="static" />
                <Label htmlFor="static" className="font-normal">
                  Static — manually select devices
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="dynamic" id="dynamic" />
                <Label htmlFor="dynamic" className="font-normal">
                  Dynamic — use rules to match devices by tags
                </Label>
              </div>
            </RadioGroup>
          </div>

          {type === 'static' ? (
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
                <RuleLivePreview conditions={ruleConditions} />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!isValid || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Creating…' : 'Create collection'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
