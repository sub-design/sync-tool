import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Cron } from 'croner'
import { ArrowRight, ArrowLeftRight, ArrowLeft, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import EndpointPicker from '@/components/EndpointPicker'
import * as api from '@/lib/api'
import { validateEndpoint } from '@/lib/backend'
import { describeCron } from '@/lib/cron'
import { useWsStore } from '@/lib/ws'
import type { Job } from '../types'

function isCronValid(expr: string): boolean {
  try { new Cron(expr); return true } catch { return false }
}

const schema = z.object({
  name:        z.string().min(1).max(60),
  source:      z.string().min(1).refine(validateEndpoint, { message: 'Invalid path or connection URL' }),
  destination: z.string().min(1).refine(validateEndpoint, { message: 'Invalid path or connection URL' }),
  direction:   z.enum(['ltr', 'bidir', 'rtl']),
  transferMode: z.enum(['auto', 'delta', 'full']),
  conflictStrategy: z.enum(['newer-wins', 'skip', 'manual']),
  encryptionEnabled: z.boolean(),
  encryptionKeyId: z.string().optional(),
  retryAttempts: z.number().int().min(0).max(10),
  retryMinTimeoutMs: z.number().int().min(50).max(60_000),
  bandwidthLimitKbps: z.number().int().min(0).max(10_000_000),
  resumeEnabled: z.boolean(),
  notifyEmail: z.string().email().optional().or(z.literal('')),
  notifyWebhookUrl: z.string().url().optional().or(z.literal('')),
  sourceDeviceId: z.string().optional(),
  destinationDeviceId: z.string().optional(),
  watch: z.boolean(),
  schedule:    z.string().optional().refine(
    val => !val || isCronValid(val),
    { message: 'Invalid cron expression' }
  ),
})

type FormValues = z.infer<typeof schema>

const DIRECTIONS = [
  { value: 'ltr'   as const, label: 'Left only',  Icon: ArrowRight },
  { value: 'bidir' as const, label: 'Both ways',  Icon: ArrowLeftRight },
  { value: 'rtl'   as const, label: 'Right only', Icon: ArrowLeft },
]

const TRANSFER_MODES = [
  { value: 'auto' as const, label: 'Auto' },
  { value: 'delta' as const, label: 'Delta' },
  { value: 'full' as const, label: 'Full' },
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
  const agentsOnline = useWsStore(s => s.agentsOnline)
  const agents = [...agentsOnline.entries()]
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
      name:        job?.name        ?? '',
      source:      job?.source      ?? '',
      destination: job?.destination ?? '',
      direction:   job?.direction   ?? 'ltr',
      transferMode: job?.transferMode ?? 'auto',
      conflictStrategy: job?.conflictStrategy ?? 'newer-wins',
      encryptionEnabled: job?.reliability?.encryptionEnabled ?? false,
      encryptionKeyId: job?.reliability?.encryptionKeyId ?? '',
      retryAttempts: job?.reliability?.retryAttempts ?? 3,
      retryMinTimeoutMs: job?.reliability?.retryMinTimeoutMs ?? 500,
      bandwidthLimitKbps: job?.reliability?.bandwidthLimitBps ? Math.round(job.reliability.bandwidthLimitBps / 1024) : 0,
      resumeEnabled: job?.reliability?.resumeEnabled ?? true,
      notifyEmail: job?.reliability?.notifyEmail ?? '',
      notifyWebhookUrl: job?.reliability?.notifyWebhookUrl ?? '',
      sourceDeviceId: job?.sourceDeviceId ?? '',
      destinationDeviceId: job?.destinationDeviceId ?? '',
      watch:       job?.watch       ?? false,
      schedule:    job?.schedule    ?? '',
    },
  })

  const direction = watch('direction')
  const transferMode = watch('transferMode')
  const conflictStrategy = watch('conflictStrategy')
  const encryptionEnabled = watch('encryptionEnabled')
  const resumeEnabled = watch('resumeEnabled')
  const watchEnabled = watch('watch')
  const schedule  = watch('schedule') ?? ''

  const schedulePreview = (() => {
    if (!schedule) return { text: 'Manual only — trigger with Run button', cls: 'text-muted-foreground' }
    if (isCronValid(schedule)) return { text: describeCron(schedule), cls: 'text-foreground' }
    return { text: 'Invalid cron expression', cls: 'text-destructive' }
  })()

  const onSubmit = async (values: FormValues) => {
    try {
      const payload = {
        name:        values.name,
        source:      values.source,
        destination: values.destination,
        direction:   values.direction,
        transferMode: values.transferMode,
        conflictStrategy: values.conflictStrategy,
        reliability: {
          encryptionEnabled: values.encryptionEnabled,
          encryptionKeyId: values.encryptionKeyId || undefined,
          retryAttempts: values.retryAttempts,
          retryMinTimeoutMs: values.retryMinTimeoutMs,
          bandwidthLimitBps: values.bandwidthLimitKbps > 0 ? values.bandwidthLimitKbps * 1024 : undefined,
          resumeEnabled: values.resumeEnabled,
          notifyEmail: values.notifyEmail || undefined,
          notifyWebhookUrl: values.notifyWebhookUrl || undefined,
        },
        sourceDeviceId: values.sourceDeviceId || undefined,
        destinationDeviceId: values.destinationDeviceId || undefined,
        watch:       values.watch,
        schedule:    values.schedule || undefined,
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
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">

      {/* Name */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="jf-name">Job name</Label>
        <Input id="jf-name" placeholder="Documents backup" {...register('name')} />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Controller
          control={control}
          name="source"
          render={({ field }) => (
            <EndpointPicker label="Source" value={field.value} onChange={field.onChange} />
          )}
        />
        {errors.source && <p className="text-xs text-destructive">{errors.source.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Controller
          control={control}
          name="destination"
          render={({ field }) => (
            <EndpointPicker label="Destination" value={field.value} onChange={field.onChange} />
          )}
        />
        {errors.destination && <p className="text-xs text-destructive">{errors.destination.message}</p>}
      </div>

      {/* Direction */}
      <div className="flex flex-col gap-1.5">
        <Label>Direction</Label>
        <div className="grid grid-cols-3 rounded-md border border-border overflow-hidden">
          {DIRECTIONS.map(({ value, label, Icon }) => (
            <Button
              key={value}
              type="button"
              variant="ghost"
              className={[
                'rounded-none w-full gap-1.5 not-last:border-r border-border',
                direction === value ? 'bg-secondary font-medium' : '',
              ].join(' ')}
              onClick={() => setValue('direction', value, { shouldValidate: true })}
            >
              <Icon size={16} />
              {label}
            </Button>
          ))}
        </div>
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
            onChange={event => setValue('encryptionEnabled', event.target.checked, { shouldValidate: true })}
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
            onChange={event => setValue('resumeEnabled', event.target.checked, { shouldValidate: true })}
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

      {/* Agents */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="jf-source-device">Source agent</Label>
          <Input
            id="jf-source-device"
            list="jf-agents"
            placeholder="optional device id"
            className="font-mono text-sm"
            {...register('sourceDeviceId')}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="jf-destination-device">Destination agent</Label>
          <Input
            id="jf-destination-device"
            list="jf-agents"
            placeholder="optional device id"
            className="font-mono text-sm"
            {...register('destinationDeviceId')}
          />
        </div>
        <datalist id="jf-agents">
          {agents.map(([deviceId, hostname]) => (
            <option key={deviceId} value={deviceId}>{hostname}</option>
          ))}
        </datalist>
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
            onChange={event => setValue('watch', event.target.checked, { shouldValidate: true })}
          />
          Auto-run on changes
        </label>
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
