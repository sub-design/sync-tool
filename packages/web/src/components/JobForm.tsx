import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Cron } from 'croner'
import { ArrowLeftRight, ArrowRight, CheckIcon, ChevronRight, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import EndpointPicker from '@/components/EndpointPicker'
import * as api from '@/lib/api'
import { validateEndpoint } from '@/lib/backend'
import { describeCron } from '@/lib/cron'
import type { Job } from '../types'

function isCronValid(expr: string): boolean {
  try { new Cron(expr); return true } catch { return false }
}

function generateJobName(): string {
  const now = new Date()
  const month = now.toLocaleString('en', { month: 'short' })
  const day   = now.getDate()
  const hh    = String(now.getHours()).padStart(2, '0')
  const mm    = String(now.getMinutes()).padStart(2, '0')
  return `Backup ${month} ${day}, ${hh}:${mm}`
}

const schema = z.object({
  name:               z.string().min(1).max(60),
  source:             z.string().min(1).refine(validateEndpoint, { message: 'Invalid path or connection URL' }),
  destination:        z.string().min(1).refine(validateEndpoint, { message: 'Invalid path or connection URL' }),
  direction:          z.enum(['ltr', 'bidir', 'rtl']),
  transferMode:       z.enum(['auto', 'delta', 'full']),
  conflictStrategy:   z.enum(['newer-wins', 'skip', 'manual']),
  encryptionEnabled:  z.boolean(),
  encryptionKeyId:    z.string().optional(),
  retryAttempts:      z.number().int().min(0).max(10),
  retryMinTimeoutMs:  z.number().int().min(50).max(60_000),
  bandwidthLimitKbps: z.number().int().min(0).max(10_000_000),
  resumeEnabled:      z.boolean(),
  notifyEmail:        z.string().email().optional().or(z.literal('')),
  notifyWebhookUrl:   z.string().url().optional().or(z.literal('')),
  sourceDeviceId:     z.string().optional(),
  destinationDeviceId: z.string().optional(),
  watch:    z.boolean(),
  schedule: z.string().optional().refine(
    val => !val || isCronValid(val),
    { message: 'Invalid cron expression' }
  ),
})

type FormValues = z.infer<typeof schema>

const TRANSFER_MODES = [
  { value: 'auto'  as const, label: 'Auto' },
  { value: 'delta' as const, label: 'Delta' },
  { value: 'full'  as const, label: 'Full' },
]

const CONFLICT_STRATEGIES = [
  { value: 'newer-wins' as const, label: 'Newer wins', description: 'Overwrite with the more recently modified file' },
  { value: 'skip'       as const, label: 'Skip',       description: 'Leave both files untouched' },
  { value: 'manual'     as const, label: 'Manual',     description: 'Mark for manual resolution' },
]

export interface JobFormProps {
  job?: Job
  onSuccess: (job: Job) => void
  onCancel?: () => void
}

export default function JobForm({ job, onSuccess, onCancel }: JobFormProps) {
  const [optionsOpen, setOptionsOpen] = useState(false)

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name:               job?.name        ?? generateJobName(),
      source:             job?.source      ?? '',
      destination:        job?.destination ?? '',
      direction:          job?.direction   ?? 'ltr',
      transferMode:       job?.transferMode ?? 'auto',
      conflictStrategy:   job?.conflictStrategy ?? 'newer-wins',
      encryptionEnabled:  job?.reliability?.encryptionEnabled ?? false,
      encryptionKeyId:    job?.reliability?.encryptionKeyId ?? '',
      retryAttempts:      job?.reliability?.retryAttempts ?? 3,
      retryMinTimeoutMs:  job?.reliability?.retryMinTimeoutMs ?? 500,
      bandwidthLimitKbps: job?.reliability?.bandwidthLimitBps ? Math.round(job.reliability.bandwidthLimitBps / 1024) : 0,
      resumeEnabled:      job?.reliability?.resumeEnabled ?? true,
      notifyEmail:        job?.reliability?.notifyEmail ?? '',
      notifyWebhookUrl:   job?.reliability?.notifyWebhookUrl ?? '',
      sourceDeviceId:     job?.sourceDeviceId ?? '',
      destinationDeviceId: job?.destinationDeviceId ?? '',
      watch:    job?.watch    ?? false,
      schedule: job?.schedule ?? '',
    },
  })

  const direction        = watch('direction')
  const transferMode     = watch('transferMode')
  const conflictStrategy = watch('conflictStrategy')
  const encryptionEnabled = watch('encryptionEnabled')
  const resumeEnabled    = watch('resumeEnabled')
  const watchEnabled     = watch('watch')
  const schedule         = watch('schedule') ?? ''

  const isSync = direction === 'bidir'

  const schedulePreview = (() => {
    if (!schedule) return { text: 'Manual only — trigger with Run button', cls: 'text-muted-foreground' }
    if (isCronValid(schedule)) return { text: describeCron(schedule), cls: 'text-foreground' }
    return { text: 'Invalid cron expression', cls: 'text-destructive' }
  })()

  const onSubmit = async (values: FormValues) => {
    try {
      const payload = {
        name:             values.name,
        source:           values.source,
        destination:      values.destination,
        direction:        values.direction,
        transferMode:     values.transferMode,
        conflictStrategy: values.conflictStrategy,
        reliability: {
          encryptionEnabled:  values.encryptionEnabled,
          encryptionKeyId:    values.encryptionKeyId || undefined,
          retryAttempts:      values.retryAttempts,
          retryMinTimeoutMs:  values.retryMinTimeoutMs,
          bandwidthLimitBps:  values.bandwidthLimitKbps > 0 ? values.bandwidthLimitKbps * 1024 : undefined,
          resumeEnabled:      values.resumeEnabled,
          notifyEmail:        values.notifyEmail || undefined,
          notifyWebhookUrl:   values.notifyWebhookUrl || undefined,
        },
        sourceDeviceId:      values.sourceDeviceId || undefined,
        destinationDeviceId: values.destinationDeviceId || undefined,
        watch:    values.watch,
        schedule: values.schedule || undefined,
      }
      const result = job
        ? await api.updateJob(job.id, payload)
        : await api.createJob(payload)
      onSuccess(result)
    } catch (err) {
      setError('root', { message: err instanceof Error ? err.message : 'Request failed' })
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">

      {/* Two-panel folder picker with direction control */}
      <div className="flex items-start gap-3">
        {/* Source / Left */}
        <div className="flex-1 min-w-0">
          <Controller
            control={control}
            name="source"
            render={({ field }) => (
              <EndpointPicker
                label={isSync ? 'Left Folder' : 'Source Folder'}
                value={field.value}
                onChange={field.onChange}
                deviceId={watch('sourceDeviceId') || undefined}
                onDeviceChange={id => setValue('sourceDeviceId', id ?? '', { shouldValidate: true })}
              />
            )}
          />
          {errors.source && <p className="text-xs text-destructive mt-1">{errors.source.message}</p>}
        </div>

        {/* Direction selector */}
        <div className="flex flex-col items-center gap-1 pt-8 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex flex-col items-center gap-1.5 rounded-lg p-2 hover:bg-accent transition-colors focus:outline-none"
              >
                <div className="size-10 rounded-full border-2 border-border flex items-center justify-center bg-background">
                  {isSync
                    ? <ArrowLeftRight size={16} className="text-foreground" />
                    : <ArrowRight     size={16} className="text-foreground" />
                  }
                </div>
                <span className="text-xs text-muted-foreground">{isSync ? 'Sync' : 'Backup'}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-64 p-1" sideOffset={8}>
              <DropdownMenuItem
                className="flex items-start gap-3 rounded-md p-3 cursor-pointer"
                onClick={() => setValue('direction', 'ltr', { shouldValidate: true })}
              >
                <div className="mt-0.5 size-5 flex items-center justify-center shrink-0">
                  <ArrowRight size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm">Backup</span>
                    {!isSync && <CheckIcon size={14} className="text-foreground shrink-0" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Copy files and folders from Source to Destination.
                  </p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex items-start gap-3 rounded-md p-3 cursor-pointer"
                onClick={() => setValue('direction', 'bidir', { shouldValidate: true })}
              >
                <div className="mt-0.5 size-5 flex items-center justify-center shrink-0">
                  <ArrowLeftRight size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm">Sync</span>
                    {isSync && <CheckIcon size={14} className="text-foreground shrink-0" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Propagate changes between Left and Right folders.
                  </p>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Destination / Right */}
        <div className="flex-1 min-w-0">
          <Controller
            control={control}
            name="destination"
            render={({ field }) => (
              <EndpointPicker
                label={isSync ? 'Right Folder' : 'Destination Folder'}
                value={field.value}
                onChange={field.onChange}
                deviceId={watch('destinationDeviceId') || undefined}
                onDeviceChange={id => setValue('destinationDeviceId', id ?? '', { shouldValidate: true })}
              />
            )}
          />
          {errors.destination && <p className="text-xs text-destructive mt-1">{errors.destination.message}</p>}
        </div>
      </div>

      {/* Job Options collapsible */}
      <div className="rounded-md border border-border overflow-hidden">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-accent transition-colors"
          onClick={() => setOptionsOpen(v => !v)}
        >
          Job Options
          <ChevronRight
            size={16}
            className={`text-muted-foreground transition-transform ${optionsOpen ? 'rotate-90' : ''}`}
          />
        </button>

        {optionsOpen && (
          <div className="flex flex-col gap-4 px-4 pb-4 pt-1 border-t border-border">

            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jf-name">Job name</Label>
              <Input id="jf-name" placeholder="Documents backup" {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            {/* Transfer mode */}
            <div className="flex flex-col gap-1.5">
              <Label>Transfer mode</Label>
              <div className="grid grid-cols-3 rounded-md border border-border overflow-hidden">
                {TRANSFER_MODES.map(({ value, label }) => (
                  <Button
                    key={value}
                    type="button"
                    variant="ghost"
                    className={[
                      'rounded-none w-full not-last:border-r border-border',
                      transferMode === value ? 'bg-secondary font-medium' : '',
                    ].join(' ')}
                    onClick={() => setValue('transferMode', value, { shouldValidate: true })}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Conflict strategy — bidir only */}
            {direction === 'bidir' && (
              <div className="flex flex-col gap-1.5">
                <Label>Conflict strategy</Label>
                <div className="grid grid-cols-3 rounded-md border border-border overflow-hidden">
                  {CONFLICT_STRATEGIES.map(({ value, label, description }) => (
                    <button
                      key={value}
                      type="button"
                      title={description}
                      className={[
                        'rounded-none px-3 py-2 text-sm not-last:border-r border-border hover:bg-accent transition-colors',
                        conflictStrategy === value ? 'bg-secondary font-medium' : '',
                      ].join(' ')}
                      onClick={() => setValue('conflictStrategy', value, { shouldValidate: true })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {CONFLICT_STRATEGIES.find(s => s.value === conflictStrategy)?.description}
                </p>
              </div>
            )}

            {/* Reliability */}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={encryptionEnabled}
                  onChange={e => setValue('encryptionEnabled', e.target.checked, { shouldValidate: true })}
                />
                AES-256 encryption
              </label>
              <Input
                placeholder="key id (optional)"
                className="font-mono text-sm"
                {...register('encryptionKeyId')}
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="jf-retry-attempts">Retry attempts</Label>
                <Input id="jf-retry-attempts" type="number" min={0} max={10} {...register('retryAttempts', { valueAsNumber: true })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="jf-retry-min">Backoff base, ms</Label>
                <Input id="jf-retry-min" type="number" min={50} step={50} {...register('retryMinTimeoutMs', { valueAsNumber: true })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="jf-bandwidth">Bandwidth limit, KiB/s</Label>
                <Input id="jf-bandwidth" type="number" min={0} placeholder="0 = unlimited" {...register('bandwidthLimitKbps', { valueAsNumber: true })} />
              </div>
              <label className="flex items-center gap-2 text-sm self-end pb-2">
                <input
                  type="checkbox"
                  checked={resumeEnabled}
                  onChange={e => setValue('resumeEnabled', e.target.checked, { shouldValidate: true })}
                />
                Resume interrupted full transfers
              </label>
            </div>

            {/* Notifications */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="jf-notify-email">Email notification</Label>
                <Input id="jf-notify-email" type="email" placeholder="ops@example.com" {...register('notifyEmail')} />
                {errors.notifyEmail && <p className="text-xs text-destructive">{errors.notifyEmail.message}</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="jf-notify-webhook">Webhook notification</Label>
                <Input id="jf-notify-webhook" placeholder="https://example.com/webhook" {...register('notifyWebhookUrl')} />
                {errors.notifyWebhookUrl && <p className="text-xs text-destructive">{errors.notifyWebhookUrl.message}</p>}
              </div>
            </div>

            {/* Schedule */}
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="jf-schedule">
                  Schedule{' '}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <div className="flex gap-2 items-center">
                  <Input
                    id="jf-schedule"
                    placeholder="0 */6 * * *"
                    {...register('schedule')}
                  />
                  <a
                    href="https://crontab.guru"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-muted-foreground shrink-0 hover:underline"
                  >
                    cron syntax
                  </a>
                </div>
                <p className={`text-xs ${schedulePreview.cls}`}>{schedulePreview.text}</p>
                {errors.schedule && <p className="text-xs text-destructive">{errors.schedule.message}</p>}
              </div>
              <label className="flex items-center gap-2 text-sm pb-2">
                <input
                  type="checkbox"
                  checked={watchEnabled}
                  onChange={e => setValue('watch', e.target.checked, { shouldValidate: true })}
                />
                Auto-run on changes
              </label>
            </div>

          </div>
        )}
      </div>

      {/* Root error */}
      {errors.root && (
        <p className="text-xs text-destructive">{errors.root.message}</p>
      )}

      {/* Actions */}
      <div className="flex gap-2 justify-end pt-1">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          {job ? 'Save changes' : 'Create job'}
        </Button>
      </div>
    </form>
  )
}
