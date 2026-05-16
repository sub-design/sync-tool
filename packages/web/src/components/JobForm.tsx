import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Cron } from 'croner'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeftRight, ArrowRight, CheckIcon, Clock, Loader2, Server } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import EndpointPicker from '@/components/EndpointPicker'
import * as api from '@/lib/api'
import { validateEndpoint } from '@/lib/backend'
import { endpointsApi } from '@/lib/endpoints'
import { describeCron } from '@/lib/cron'
import type { Job } from '../types'

// ── Utilities ─────────────────────────────────────────────────────────────────

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

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// ── Zod schema ────────────────────────────────────────────────────────────────

const schema = z.object({
  name:               z.string().min(1).max(60),
  source:             z.string(),
  destination:        z.string(),
  sourceEndpointId:      z.string().optional(),
  destinationEndpointId: z.string().optional(),
  direction:          z.enum(['ltr', 'bidir', 'rtl']),
  transferMode:       z.enum(['auto', 'delta', 'full']),
  conflictStrategy:   z.enum(['newer-wins', 'skip', 'manual']),
  deletionPolicy:     z.enum(['backup', 'backup-with-deletes', 'mirror']),
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
  fileChangeDelaySec: z.number().int().min(0).max(86_400),
  onFolderConnect: z.boolean(),
  onStart: z.boolean(),
  periodicEnabled: z.boolean(),
  periodicHours: z.number().int().min(0).max(10_000),
  periodicMinutes: z.number().int().min(0).max(59),
  onLogoff: z.boolean(),
  unattended: z.boolean(),
  skipIfChangedPercentEnabled: z.boolean(),
  skipIfChangedPercent: z.number().int().min(1).max(100_000),
  waitForLocksEnabled: z.boolean(),
  waitForLocksMinutes: z.number().int().min(0).max(10_080),
  autoClearTreeAfterSync: z.boolean(),
  schedule: z.string().optional().refine(
    val => !val || isCronValid(val),
    { message: 'Invalid cron expression' }
  ),
})

type FormValues = z.infer<typeof schema>

// ── Nav ────────────────────────────────────────────────────────────────────────

type NavItem =
  | { kind: 'group'; label: string }
  | { kind: 'item'; id: string; label: string; indent?: boolean }

const NAV: NavItem[] = [
  { kind: 'item',  id: 'general',  label: 'General' },
  { kind: 'item',  id: 'paths',    label: 'Source & Destination' },
  { kind: 'item',  id: 'filters',  label: 'Filters' },
  { kind: 'item',  id: 'schedule', label: 'Schedule' },
  { kind: 'group', label: 'Sync behavior' },
  { kind: 'item',  id: 'analyze',  label: 'Analyze',       indent: true },
  { kind: 'item',  id: 'syncopts', label: 'Sync options',  indent: true },
  { kind: 'item',  id: 'conflicts',label: 'Conflicts' },
  { kind: 'group', label: 'Advanced' },
  { kind: 'item',  id: 'history',  label: 'History',       indent: true },
  { kind: 'item',  id: 'limits',   label: 'Speed / limits',indent: true },
  { kind: 'item',  id: 'scripts',  label: 'Scripts',       indent: true },
  { kind: 'item',  id: 'compare',  label: 'Comparison',    indent: true },
]

const PLACEHOLDER_FIELDS: Record<string, string[]> = {
  general:   ['Job name', 'Description', 'Tags', 'Enabled'],
  filters:   ['Include patterns', 'Exclude patterns', 'Skip hidden files', 'Max file size'],
  analyze:   ['Hash algorithm', 'Mtime tolerance', 'Re-use last analysis', 'Parallel workers'],
  syncopts:  ['Delete extraneous', 'Preserve timestamps', 'Compression', 'Dry run mode'],
  conflicts: ['On conflict', 'Keep both', 'Backup folder', 'Auto-resolve same content'],
  history:   ['Keep N runs', 'Retain logs for', 'Export history', 'Clear history'],
  limits:    ['Bandwidth cap', 'Concurrent transfers', 'CPU priority', 'Pause on metered'],
  scripts:   ['Pre-sync command', 'Post-sync command', 'On-error command', 'Run as user'],
  compare:   ['Compare by', 'Ignore mtime drift', 'Ignore size diff', 'Compare permissions'],
}

// ── NavRail ───────────────────────────────────────────────────────────────────

function NavRail({ active, setActive, scheduleTriggerCount }: {
  active: string
  setActive: (id: string) => void
  scheduleTriggerCount: number
}) {
  return (
    <nav className="w-[200px] shrink-0 border-r overflow-y-auto py-3 px-2 text-sm bg-muted/30">
      {NAV.map((n, i) => {
        if (n.kind === 'group') {
          return (
            <div key={i} className="px-2.5 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {n.label}
            </div>
          )
        }
        const isActive = n.id === active
        return (
          <button
            key={n.id}
            type="button"
            onClick={() => setActive(n.id)}
            className={[
              'flex w-full items-center gap-2 rounded-md mb-px text-sm transition-colors',
              n.indent ? 'pl-[22px] pr-2.5 py-1.5' : 'px-2.5 py-1.5',
              isActive
                ? 'bg-background font-medium text-foreground shadow-sm border-l-2 border-l-primary pl-[calc(10px-2px)]'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              n.indent && isActive ? 'pl-[calc(22px-2px)]' : '',
            ].join(' ')}
          >
            <span className="flex-1 text-left">{n.label}</span>
            {n.id === 'schedule' && scheduleTriggerCount > 0 && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                {scheduleTriggerCount}
              </Badge>
            )}
          </button>
        )
      })}
    </nav>
  )
}

// ── PaneHeader ────────────────────────────────────────────────────────────────

function PaneHeader({ title, subtitle, action }: {
  title: string
  subtitle?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <div className="flex-1 min-w-0">
        <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

// ── PreviewButton + Popover ───────────────────────────────────────────────────

const TRIGGER_COLORS: Record<string, string> = {
  schedule:   'hsl(var(--primary))',
  periodic:   '#5d6f8b',
  filechange: '#1f6b3a',
  folders:    '#9a6510',
  logoff:     '#7a3a5a',
  onstart:    '#7a4a8a',
}

function PreviewButton() {
  const [open, setOpen] = useState(false)

  const runs = [
    { day: 'Today',    time: '09:00', dur: '~4 min',  trigger: 'schedule',  note: 'daily 09:00' },
    { day: 'Today',    time: '09:30', dur: 'idle',    trigger: 'periodic',  note: 'every 30 min' },
    { day: 'Today',    time: '10:00', dur: 'idle',    trigger: 'periodic' },
    { day: 'Today',    time: '14:22', dur: '—',       trigger: 'folders',   note: 'when drive mounts' },
    { day: 'Today',    time: '18:00', dur: 'skipped', trigger: 'periodic',  skipped: true, note: 'overlap' },
    { day: 'Tomorrow', time: '09:00', dur: '~4 min',  trigger: 'schedule' },
    { day: 'Tomorrow', time: '09:30', dur: 'idle',    trigger: 'periodic' },
  ]

  return (
    <div className="relative flex-shrink-0">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={open ? 'bg-primary text-primary-foreground hover:bg-primary/90 border-primary' : ''}
        onClick={() => setOpen(o => !o)}
      >
        <Clock size={13} />
        Preview next runs
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />
          <div className="absolute top-[calc(100%+8px)] right-0 z-51 w-[300px] rounded-lg border bg-card shadow-xl">
            <div className="p-3.5">
              <div className="flex items-center mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Next runs
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground">simulated</span>
              </div>

              <div className="flex flex-wrap gap-2 mb-3">
                {(['schedule', 'periodic', 'filechange', 'folders'] as const).map(k => (
                  <span key={k} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="w-2 h-2 rounded-full inline-block" style={{ background: TRIGGER_COLORS[k] }} />
                    {k}
                  </span>
                ))}
              </div>

              <div className="relative max-h-72 overflow-y-auto">
                <div className="absolute left-[7px] top-1.5 bottom-1.5 w-0.5 bg-border" />
                {runs.map((r, i) => {
                  const newDay = i === 0 || runs[i - 1].day !== r.day
                  return (
                    <div key={i}>
                      {newDay && (
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground pl-[22px] pt-1.5 pb-1">
                          {r.day}
                        </div>
                      )}
                      <div className={`flex items-start gap-2.5 py-1 relative ${r.skipped ? 'opacity-50' : ''}`}>
                        <div
                          className="w-4 h-4 rounded-full bg-card border-2 flex-shrink-0 relative z-10 flex items-center justify-center"
                          style={{ borderColor: TRIGGER_COLORS[r.trigger] }}
                        >
                          {r.skipped && (
                            <div className="w-2 h-[2px]" style={{ background: TRIGGER_COLORS[r.trigger] }} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-1.5">
                            <span className="font-mono text-xs font-medium">{r.time}</span>
                            <span className="text-[10px] text-muted-foreground uppercase">{r.dur}</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {r.trigger}{r.note ? ` · ${r.note}` : ''}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="mt-3 p-2.5 bg-muted/50 border rounded text-[11px] text-muted-foreground leading-relaxed">
                File-change runs fire reactively — not shown in the agenda.
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── ScheduleBuilder ───────────────────────────────────────────────────────────

type SchedMode = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'

const DOW = [
  { id: 'mon', short: 'M', label: 'Mon', dow: 1 },
  { id: 'tue', short: 'T', label: 'Tue', dow: 2 },
  { id: 'wed', short: 'W', label: 'Wed', dow: 3 },
  { id: 'thu', short: 'T', label: 'Thu', dow: 4 },
  { id: 'fri', short: 'F', label: 'Fri', dow: 5 },
  { id: 'sat', short: 'S', label: 'Sat', dow: 6 },
  { id: 'sun', short: 'S', label: 'Sun', dow: 0 },
]

const SCHED_MODES: { id: SchedMode; label: string }[] = [
  { id: 'hourly',  label: 'Hourly' },
  { id: 'daily',   label: 'Daily' },
  { id: 'weekly',  label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'custom',  label: 'Custom' },
]

function parseCronToState(cron: string): {
  mode: SchedMode; time: string; days: string[]
  hourly: { every: number; atMinute: number }; monthly: { day: number }
  customCron: string
} {
  const defaults = {
    mode: 'daily' as SchedMode, time: '09:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    hourly: { every: 6, atMinute: 0 }, monthly: { day: 1 }, customCron: cron || '0 */6 * * *',
  }
  if (!cron) return defaults
  try {
    const parts = cron.trim().split(/\s+/)
    if (parts.length !== 5) return { ...defaults, mode: 'custom', customCron: cron }
    const [min, hour, dom, , dow] = parts
    const pad = (n: number) => String(n).padStart(2, '0')

    // hourly: `n */h * * *`
    if (hour.startsWith('*/') && dom === '*' && dow === '*') {
      const every = parseInt(hour.slice(2), 10)
      const atMinute = parseInt(min, 10)
      if (!isNaN(every) && !isNaN(atMinute)) {
        return { ...defaults, mode: 'hourly', hourly: { every, atMinute } }
      }
    }
    // daily: `m h * * *`
    if (dom === '*' && dow === '*' && !hour.includes('/') && !min.includes('/')) {
      const h = parseInt(hour, 10), m = parseInt(min, 10)
      if (!isNaN(h) && !isNaN(m)) {
        return { ...defaults, mode: 'daily', time: `${pad(h)}:${pad(m)}` }
      }
    }
    // weekly: `m h * * dow-list`
    if (dom === '*' && dow !== '*' && !hour.includes('/')) {
      const h = parseInt(hour, 10), m = parseInt(min, 10)
      if (!isNaN(h) && !isNaN(m)) {
        const selectedDows = dow.split(',').map(Number)
        const days = DOW.filter(d => selectedDows.includes(d.dow)).map(d => d.id)
        return { ...defaults, mode: 'weekly', time: `${pad(h)}:${pad(m)}`, days }
      }
    }
    // monthly: `m h dayofmonth * *`
    if (dow === '*' && !dom.includes('/') && dom !== '*') {
      const h = parseInt(hour, 10), m = parseInt(min, 10), day = parseInt(dom, 10)
      if (!isNaN(h) && !isNaN(m) && !isNaN(day)) {
        return { ...defaults, mode: 'monthly', time: `${pad(h)}:${pad(m)}`, monthly: { day } }
      }
    }
    return { ...defaults, mode: 'custom', customCron: cron }
  } catch {
    return { ...defaults, mode: 'custom', customCron: cron }
  }
}

function buildCron(
  mode: SchedMode, time: string, days: string[],
  hourly: { every: number; atMinute: number }, monthly: { day: number }, customCron: string
): string {
  const h = parseInt(time.slice(0, 2), 10)
  const m = parseInt(time.slice(3), 10)
  if (mode === 'hourly') return `${hourly.atMinute} */${hourly.every} * * *`
  if (mode === 'daily')  return `${m} ${h} * * *`
  if (mode === 'weekly') {
    const dows = DOW.filter(d => days.includes(d.id)).map(d => d.dow)
    return `${m} ${h} * * ${dows.join(',') || '*'}`
  }
  if (mode === 'monthly') return `${m} ${h} ${monthly.day} * *`
  return customCron
}

function ScheduleBuilder({ value, onChange }: { value: string; onChange: (cron: string) => void }) {
  const initial = useMemo(() => parseCronToState(value), [])
  const [mode, setMode]       = useState<SchedMode>(initial.mode)
  const [time, setTime]       = useState(initial.time)
  const [days, setDays]       = useState<string[]>(initial.days)
  const [hourly, setHourly]   = useState(initial.hourly)
  const [monthly, setMonthly] = useState(initial.monthly)
  const [customCron, setCustomCron] = useState(initial.customCron)
  const [showCron, setShowCron] = useState(false)

  const toggleDay = (id: string) =>
    setDays(d => d.includes(id) ? d.filter(x => x !== id) : [...d, id])

  const update = (
    newMode = mode, newTime = time, newDays = days,
    newHourly = hourly, newMonthly = monthly, newCustom = customCron
  ) => {
    onChange(buildCron(newMode, newTime, newDays, newHourly, newMonthly, newCustom))
  }

  const currentCron = buildCron(mode, time, days, hourly, monthly, customCron)
  const summary = mode !== 'custom' && isCronValid(currentCron)
    ? describeCron(currentCron)
    : mode === 'custom' ? (isCronValid(customCron) ? describeCron(customCron) : 'Invalid cron expression') : ''

  const inputCls = "h-8 px-2.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"

  return (
    <div>
      {/* Mode tabs */}
      <div className="inline-flex p-0.5 bg-muted border rounded-lg gap-0.5 mb-4">
        {SCHED_MODES.map(m => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              setMode(m.id)
              update(m.id)
            }}
            className={[
              'px-3 py-1 text-xs font-medium rounded-md transition-colors',
              mode === m.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Mode body */}
      <div className="mb-4">
        {mode === 'hourly' && (
          <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
            Every
            <select
              className={inputCls}
              value={hourly.every}
              onChange={e => {
                const next = { ...hourly, every: +e.target.value }
                setHourly(next)
                update(mode, time, days, next)
              }}
            >
              {[1, 2, 3, 4, 6, 8, 12].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            hour{hourly.every === 1 ? '' : 's'}, at minute
            <select
              className={inputCls}
              value={hourly.atMinute}
              onChange={e => {
                const next = { ...hourly, atMinute: +e.target.value }
                setHourly(next)
                update(mode, time, days, next)
              }}
            >
              {[0, 15, 30, 45].map(n => (
                <option key={n} value={n}>:{String(n).padStart(2, '0')}</option>
              ))}
            </select>
          </div>
        )}

        {mode === 'daily' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            At
            <input
              type="time"
              className={inputCls}
              value={time}
              onChange={e => { setTime(e.target.value); update(mode, e.target.value) }}
            />
            every day
          </div>
        )}

        {mode === 'weekly' && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-1">
              {DOW.map(d => {
                const on = days.includes(d.id)
                return (
                  <button
                    key={d.id}
                    type="button"
                    title={d.label}
                    onClick={() => {
                      const next = days.includes(d.id) ? days.filter(x => x !== d.id) : [...days, d.id]
                      toggleDay(d.id)
                      update(mode, time, next)
                    }}
                    className={[
                      'w-8 h-8 rounded-md text-xs font-medium border transition-colors',
                      on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border hover:border-primary/50',
                    ].join(' ')}
                  >
                    {d.short}
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              at
              <input
                type="time"
                className={inputCls}
                value={time}
                onChange={e => { setTime(e.target.value); update(mode, e.target.value) }}
              />
            </div>
          </div>
        )}

        {mode === 'monthly' && (
          <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
            On the
            <select
              className={inputCls}
              value={monthly.day}
              onChange={e => {
                const next = { day: +e.target.value }
                setMonthly(next)
                update(mode, time, days, hourly, next)
              }}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map(n => (
                <option key={n} value={n}>{ordinal(n)}</option>
              ))}
            </select>
            of every month, at
            <input
              type="time"
              className={inputCls}
              value={time}
              onChange={e => { setTime(e.target.value); update(mode, e.target.value) }}
            />
          </div>
        )}

        {mode === 'custom' && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Five fields: <code className="font-mono bg-muted px-1 rounded text-[11px]">min hour day month dow</code>
            </p>
            <input
              className="w-full h-9 px-3 font-mono text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              value={customCron}
              onChange={e => { setCustomCron(e.target.value); update(mode, time, days, hourly, monthly, e.target.value) }}
            />
            <div className="flex flex-wrap gap-1.5">
              {[['Every hour','0 * * * *'],['Every 6h','0 */6 * * *'],['Weekdays 9am','0 9 * * 1-5'],['Sundays midnight','0 0 * * 0']].map(([l, c]) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => { setCustomCron(c); update(mode, time, days, hourly, monthly, c) }}
                  className="text-[11px] px-2 py-0.5 border rounded-full bg-background text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Summary box */}
      <div className="p-3 bg-muted/50 border rounded-md">
        <div className="flex items-start gap-2.5">
          <span className="text-primary text-base leading-none mt-0.5">↻</span>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium ${summary === 'Invalid cron expression' ? 'text-destructive' : ''}`}>
              {summary || 'Set a schedule above'}
            </p>
          </div>
          {mode !== 'custom' && (
            <button
              type="button"
              onClick={() => setShowCron(v => !v)}
              className="text-[11px] text-muted-foreground underline underline-offset-2 shrink-0"
            >
              {showCron ? 'Hide cron' : 'Show as cron'}
            </button>
          )}
        </div>
        {showCron && mode !== 'custom' && (
          <div className="mt-2 pt-2 border-t text-[11px] text-muted-foreground">
            Equivalent cron: <code className="font-mono bg-background border px-1.5 py-0.5 rounded text-foreground">{currentCron}</code>
          </div>
        )}
      </div>
    </div>
  )
}

// ── CompactTrigger ─────────────────────────────────────────────────────────────

function CompactTrigger({ name, enabled, onToggle, children, wideBody = false }: {
  name: string
  enabled: boolean
  onToggle: () => void
  children?: React.ReactNode
  wideBody?: boolean
}) {
  return (
    <div className={`rounded-md border p-3 mb-2 transition-opacity ${enabled ? '' : 'opacity-70'}`}>
      <div className="flex items-center gap-3">
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
        />
        <span className="flex-1 text-sm font-medium">{name}</span>
        {enabled && (
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-medium">
            live
          </Badge>
        )}
      </div>
      {enabled && children && (
        <div className={`mt-3 flex flex-wrap gap-3 items-start ${wideBody ? '' : 'pl-[46px]'}`}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── SmallField ─────────────────────────────────────────────────────────────────

function SmallField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  )
}

// ── SectionDivider ─────────────────────────────────────────────────────────────

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-4">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

// ── SchedulePane ──────────────────────────────────────────────────────────────

interface SchedulePaneProps {
  watch: ReturnType<typeof useForm<FormValues>>['watch']
  setValue: ReturnType<typeof useForm<FormValues>>['setValue']
  register: ReturnType<typeof useForm<FormValues>>['register']
}

function SchedulePane({ watch: watchField, setValue, register }: SchedulePaneProps) {
  const watchEnabled     = watchField('watch') as boolean
  const periodicEnabled  = watchField('periodicEnabled') as boolean
  const scheduleVal      = (watchField('schedule') as string) ?? ''
  const onFolderConnect  = watchField('onFolderConnect') as boolean
  const onLogoff         = watchField('onLogoff') as boolean
  const onStart          = watchField('onStart') as boolean
  const skipEnabled      = watchField('skipIfChangedPercentEnabled') as boolean
  const waitEnabled      = watchField('waitForLocksEnabled') as boolean
  const unattended       = watchField('unattended') as boolean
  const autoClear        = watchField('autoClearTreeAfterSync') as boolean
  const scheduleEnabled  = Boolean(scheduleVal)

  return (
    <>
      <PaneHeader
        title="Schedule"
        subtitle="When this job should run on its own. Manual run is always available."
        action={<PreviewButton />}
      />

      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
        Triggers
      </div>

      <CompactTrigger
        name="When files change"
        enabled={watchEnabled}
        onToggle={() => setValue('watch', !watchEnabled, { shouldValidate: true })}
      >
        <SmallField label="Delay">
          <Input
            type="number"
            min={0}
            className="h-7 w-16 text-sm"
            {...register('fileChangeDelaySec', { valueAsNumber: true })}
          />
          <span className="text-xs text-muted-foreground">s</span>
        </SmallField>
      </CompactTrigger>

      <CompactTrigger
        name="Repeating interval"
        enabled={periodicEnabled}
        onToggle={() => setValue('periodicEnabled', !periodicEnabled, { shouldValidate: true })}
      >
        <SmallField label="Every">
          <Input
            type="number"
            min={0}
            className="h-7 w-16 text-sm"
            {...register('periodicHours', { valueAsNumber: true })}
          />
          <span className="text-xs text-muted-foreground">h</span>
          <Input
            type="number"
            min={0}
            max={59}
            className="h-7 w-16 text-sm"
            {...register('periodicMinutes', { valueAsNumber: true })}
          />
          <span className="text-xs text-muted-foreground">min</span>
        </SmallField>
      </CompactTrigger>

      <CompactTrigger
        name="On a schedule"
        enabled={scheduleEnabled}
        onToggle={() => {
          if (scheduleEnabled) {
            setValue('schedule', '', { shouldValidate: true })
          } else {
            setValue('schedule', '0 9 * * *', { shouldValidate: true })
          }
        }}
        wideBody
      >
        <div className="w-full">
          <ScheduleBuilder
            value={scheduleVal}
            onChange={cron => setValue('schedule', cron, { shouldValidate: true })}
          />
        </div>
      </CompactTrigger>

      <CompactTrigger
        name="When a folder connects"
        enabled={onFolderConnect}
        onToggle={() => setValue('onFolderConnect', !onFolderConnect, { shouldValidate: true })}
      >
        <p className="text-xs text-muted-foreground">Runs when a mounted volume or folder becomes available.</p>
      </CompactTrigger>

      <CompactTrigger
        name="Before logoff / shutdown"
        enabled={onLogoff}
        onToggle={() => setValue('onLogoff', !onLogoff, { shouldValidate: true })}
      >
        <p className="text-xs text-muted-foreground">One last sync when the OS reports a logout. Best for small jobs.</p>
      </CompactTrigger>

      <CompactTrigger
        name="On API start"
        enabled={onStart}
        onToggle={() => setValue('onStart', !onStart, { shouldValidate: true })}
      />

      <SectionDivider label="Before each run · guards" />

      <div className="flex flex-wrap gap-5">
        <div className="flex items-center gap-2">
          <Switch
            checked={waitEnabled}
            onCheckedChange={v => setValue('waitForLocksEnabled', v, { shouldValidate: true })}
          />
          <span className="text-sm text-muted-foreground">Wait for locks</span>
          <Input
            type="number"
            min={0}
            className="h-7 w-16 text-sm"
            disabled={!waitEnabled}
            {...register('waitForLocksMinutes', { valueAsNumber: true })}
          />
          <span className="text-xs text-muted-foreground">min</span>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            checked={skipEnabled}
            onCheckedChange={v => setValue('skipIfChangedPercentEnabled', v, { shouldValidate: true })}
          />
          <span className="text-sm text-muted-foreground">Skip if changed &gt;</span>
          <Input
            type="number"
            min={1}
            className="h-7 w-16 text-sm"
            disabled={!skipEnabled}
            {...register('skipIfChangedPercent', { valueAsNumber: true })}
          />
          <span className="text-xs text-muted-foreground">%</span>
        </div>
      </div>

      <SectionDivider label="During & after the run" />

      <div className="flex flex-col gap-1">
        <div className="flex items-start gap-3 py-2">
          <Switch
            checked={unattended}
            onCheckedChange={v => setValue('unattended', v, { shouldValidate: true })}
          />
          <div>
            <p className="text-sm">Run silently in the background</p>
            <p className="text-xs text-muted-foreground mt-0.5">No prompts, no UI windows. Errors land in the job's log.</p>
          </div>
        </div>
        <div className="flex items-start gap-3 py-2">
          <Switch
            checked={autoClear}
            onCheckedChange={v => setValue('autoClearTreeAfterSync', v, { shouldValidate: true })}
          />
          <div>
            <p className="text-sm">Clear analyze tree after sync</p>
            <p className="text-xs text-muted-foreground mt-0.5">Drops the saved analysis once the run completes.</p>
          </div>
        </div>
      </div>
    </>
  )
}

// ── EndpointModeToggle ────────────────────────────────────────────────────────

interface EndpointModeToggleProps {
  label: string
  saved: boolean
  onToggle: (saved: boolean) => void
  endpoints: import('../types').Endpoint[]
  endpointId: string
  onEndpointChange: (id: string) => void
  manualPicker: React.ReactNode
}

function EndpointModeToggle({
  label, saved, onToggle, endpoints, endpointId, onEndpointChange, manualPicker,
}: EndpointModeToggleProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {endpoints.length > 0 && (
          <div className="flex rounded-md border border-border overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => onToggle(false)}
              className={`px-2 py-0.5 transition-colors ${!saved ? 'bg-secondary font-medium' : 'hover:bg-accent'}`}
            >
              Manual
            </button>
            <button
              type="button"
              onClick={() => onToggle(true)}
              className={`px-2 py-0.5 border-l border-border transition-colors flex items-center gap-1 ${saved ? 'bg-secondary font-medium' : 'hover:bg-accent'}`}
            >
              <Server size={10} /> Saved
            </button>
          </div>
        )}
      </div>
      {saved ? (
        <Select value={endpointId} onValueChange={onEndpointChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select saved endpoint…" />
          </SelectTrigger>
          <SelectContent>
            {endpoints.map(ep => (
              <SelectItem key={ep.id} value={ep.id}>
                <span className="flex items-center gap-2">
                  <span className="text-xs uppercase text-muted-foreground font-mono w-8">{ep.type}</span>
                  {ep.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        manualPicker
      )}
    </div>
  )
}

// ── SourceDestPane ─────────────────────────────────────────────────────────────

interface SourceDestPaneProps {
  job?: Job
  isSync: boolean
  srcSaved: boolean
  dstSaved: boolean
  setSrcSaved: (v: boolean) => void
  setDstSaved: (v: boolean) => void
  endpoints: import('../types').Endpoint[]
  control: ReturnType<typeof useForm<FormValues>>['control']
  watch: ReturnType<typeof useForm<FormValues>>['watch']
  setValue: ReturnType<typeof useForm<FormValues>>['setValue']
  errors: ReturnType<typeof useForm<FormValues>>['formState']['errors']
  register: ReturnType<typeof useForm<FormValues>>['register']
}

function SourceDestPane({
  isSync, srcSaved, dstSaved, setSrcSaved, setDstSaved,
  endpoints, control, watch, setValue, errors, register,
}: SourceDestPaneProps) {
  return (
    <>
      <PaneHeader
        title="Source & Destination"
        subtitle="Where files come from and where they go."
      />

      {/* Name */}
      <div className="flex flex-col gap-1.5 mb-5">
        <Label htmlFor="jf-name">Job name</Label>
        <Input id="jf-name" placeholder="Documents backup" {...register('name')} />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      {/* Two-panel folder picker */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <EndpointModeToggle
            label={isSync ? 'Left Folder' : 'Source Folder'}
            saved={srcSaved}
            onToggle={v => { setSrcSaved(v); if (v) setValue('source', ''); else setValue('sourceEndpointId', '') }}
            endpoints={endpoints}
            endpointId={watch('sourceEndpointId') ?? ''}
            onEndpointChange={id => setValue('sourceEndpointId', id, { shouldValidate: true })}
            manualPicker={
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
            }
          />
          {errors.source && <p className="text-xs text-destructive mt-1">{errors.source.message}</p>}
        </div>

        {/* Direction selector */}
        <div className="flex flex-col items-center gap-1 pt-6 shrink-0">
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

        <div className="flex-1 min-w-0">
          <EndpointModeToggle
            label={isSync ? 'Right Folder' : 'Destination Folder'}
            saved={dstSaved}
            onToggle={v => { setDstSaved(v); if (v) setValue('destination', ''); else setValue('destinationEndpointId', '') }}
            endpoints={endpoints}
            endpointId={watch('destinationEndpointId') ?? ''}
            onEndpointChange={id => setValue('destinationEndpointId', id, { shouldValidate: true })}
            manualPicker={
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
            }
          />
          {errors.destination && <p className="text-xs text-destructive mt-1">{errors.destination.message}</p>}
        </div>
      </div>
    </>
  )
}

// ── GeneralPane ───────────────────────────────────────────────────────────────

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

const DELETION_POLICIES = [
  { value: 'backup'              as const, label: 'Backup',       description: 'Keep destination files when they disappear from source' },
  { value: 'backup-with-deletes' as const, label: 'With deletes', description: 'Delete only destination files previously synced by this job' },
  { value: 'mirror'              as const, label: 'Mirror',       description: 'Make destination exactly match source' },
]

interface GeneralPaneProps {
  watch: ReturnType<typeof useForm<FormValues>>['watch']
  setValue: ReturnType<typeof useForm<FormValues>>['setValue']
  register: ReturnType<typeof useForm<FormValues>>['register']
  errors: ReturnType<typeof useForm<FormValues>>['formState']['errors']
}

function GeneralPane({ watch, setValue, register, errors }: GeneralPaneProps) {
  const transferMode     = watch('transferMode')
  const conflictStrategy = watch('conflictStrategy')
  const deletionPolicy   = watch('deletionPolicy')
  const direction        = watch('direction')
  const encryptionEnabled = watch('encryptionEnabled')
  const resumeEnabled    = watch('resumeEnabled')

  return (
    <>
      <PaneHeader title="General" subtitle="Transfer behaviour, reliability, and notifications." />

      <div className="flex flex-col gap-5">
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

        {/* Deletion policy — one-way only */}
        {direction !== 'bidir' && (
          <div className="flex flex-col gap-1.5">
            <Label>Destination deletes</Label>
            <div className="grid grid-cols-3 rounded-md border border-border overflow-hidden">
              {DELETION_POLICIES.map(({ value, label, description }) => (
                <button
                  key={value}
                  type="button"
                  title={description}
                  className={[
                    'rounded-none px-3 py-2 text-sm not-last:border-r border-border hover:bg-accent transition-colors',
                    deletionPolicy === value ? 'bg-secondary font-medium' : '',
                  ].join(' ')}
                  onClick={() => setValue('deletionPolicy', value, { shouldValidate: true })}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {DELETION_POLICIES.find(p => p.value === deletionPolicy)?.description}
            </p>
          </div>
        )}

        {/* Reliability */}
        <div className="flex flex-col gap-3">
          <Label>Reliability</Label>
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
        </div>

        {/* Notifications */}
        <div className="flex flex-col gap-3">
          <Label>Notifications</Label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jf-notify-email" className="font-normal text-muted-foreground">Email</Label>
              <Input id="jf-notify-email" type="email" placeholder="ops@example.com" {...register('notifyEmail')} />
              {errors.notifyEmail && <p className="text-xs text-destructive">{errors.notifyEmail.message}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jf-notify-webhook" className="font-normal text-muted-foreground">Webhook</Label>
              <Input id="jf-notify-webhook" placeholder="https://example.com/webhook" {...register('notifyWebhookUrl')} />
              {errors.notifyWebhookUrl && <p className="text-xs text-destructive">{errors.notifyWebhookUrl.message}</p>}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ── PlaceholderPane ───────────────────────────────────────────────────────────

function PlaceholderPane({ id }: { id: string }) {
  const fields = PLACEHOLDER_FIELDS[id] ?? []
  const label = NAV.find(n => n.kind === 'item' && n.id === id)?.label ?? id
  return (
    <>
      <PaneHeader title={label} />
      <div className="border border-dashed rounded-md bg-muted/30 p-5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-4">Coming soon</p>
        <div className="grid grid-cols-2 gap-4">
          {fields.map(f => (
            <div key={f}>
              <div className="text-xs text-muted-foreground mb-1.5">{f}</div>
              <div className="h-8 bg-background border rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// ── JobForm ────────────────────────────────────────────────────────────────────

export interface JobFormProps {
  job?: Job
  onSuccess: (job: Job) => void
  onCancel?: () => void
}

export default function JobForm({ job, onSuccess, onCancel }: JobFormProps) {
  const [pane, setPane]       = useState('paths')
  const [srcSaved, setSrcSaved] = useState(Boolean(job?.sourceEndpointId))
  const [dstSaved, setDstSaved] = useState(Boolean(job?.destinationEndpointId))

  const { data: endpoints = [] } = useQuery({
    queryKey: ['endpoints'],
    queryFn:  endpointsApi.list,
  })

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
      deletionPolicy:     job?.deletionPolicy ?? 'backup',
      encryptionEnabled:  job ? (job.reliability?.encryptionEnabled ?? false) : true,
      encryptionKeyId:    job?.reliability?.encryptionKeyId ?? '',
      retryAttempts:      job?.reliability?.retryAttempts ?? 3,
      retryMinTimeoutMs:  job?.reliability?.retryMinTimeoutMs ?? 500,
      bandwidthLimitKbps: job?.reliability?.bandwidthLimitBps ? Math.round(job.reliability.bandwidthLimitBps / 1024) : 0,
      resumeEnabled:      job?.reliability?.resumeEnabled ?? true,
      notifyEmail:        job?.reliability?.notifyEmail ?? '',
      notifyWebhookUrl:   job?.reliability?.notifyWebhookUrl ?? '',
      sourceDeviceId:        job?.sourceDeviceId ?? '',
      destinationDeviceId:   job?.destinationDeviceId ?? '',
      sourceEndpointId:      job?.sourceEndpointId ?? '',
      destinationEndpointId: job?.destinationEndpointId ?? '',
      watch:    job?.watch    ?? false,
      fileChangeDelaySec: job?.autoOptions?.fileChangeDelaySec ?? 20,
      onFolderConnect: job?.autoOptions?.onFolderConnect ?? false,
      onStart: job?.autoOptions?.onStart ?? false,
      periodicEnabled: Boolean(job?.autoOptions?.periodicEveryMinutes),
      periodicHours: Math.floor((job?.autoOptions?.periodicEveryMinutes ?? 120) / 60),
      periodicMinutes: (job?.autoOptions?.periodicEveryMinutes ?? 120) % 60,
      onLogoff: job?.autoOptions?.onLogoff ?? false,
      unattended: job?.autoOptions?.unattended ?? false,
      skipIfChangedPercentEnabled: job?.autoOptions?.skipIfChangedPercent != null,
      skipIfChangedPercent: job?.autoOptions?.skipIfChangedPercent ?? 100,
      waitForLocksEnabled: job?.autoOptions?.waitForLocksMinutes != null,
      waitForLocksMinutes: job?.autoOptions?.waitForLocksMinutes ?? 0,
      autoClearTreeAfterSync: job?.autoOptions?.autoClearTreeAfterSync ?? false,
      schedule: job?.schedule ?? '',
    },
  })

  const direction = watch('direction')
  const isSync = direction === 'bidir'

  const scheduleTriggerCount = [
    watch('watch'),
    watch('periodicEnabled'),
    Boolean(watch('schedule')),
    watch('onFolderConnect'),
    watch('onLogoff'),
    watch('onStart'),
  ].filter(Boolean).length

  const onSubmit = async (values: FormValues) => {
    if (!srcSaved && !validateEndpoint(values.source)) {
      setError('source', { message: 'Invalid path or connection URL' }); setPane('paths'); return
    }
    if (!dstSaved && !validateEndpoint(values.destination)) {
      setError('destination', { message: 'Invalid path or connection URL' }); setPane('paths'); return
    }
    if (srcSaved && !values.sourceEndpointId) {
      setError('source', { message: 'Select a saved endpoint' }); setPane('paths'); return
    }
    if (dstSaved && !values.destinationEndpointId) {
      setError('destination', { message: 'Select a saved endpoint' }); setPane('paths'); return
    }
    try {
      const periodicEveryMinutes = values.periodicEnabled
        ? values.periodicHours * 60 + values.periodicMinutes
        : undefined
      const payload = {
        name:             values.name,
        source:           srcSaved ? '' : values.source,
        destination:      dstSaved ? '' : values.destination,
        sourceEndpointId:      srcSaved ? (values.sourceEndpointId || undefined) : undefined,
        destinationEndpointId: dstSaved ? (values.destinationEndpointId || undefined) : undefined,
        direction:        values.direction,
        transferMode:     values.transferMode,
        conflictStrategy: values.conflictStrategy,
        deletionPolicy:   values.direction === 'bidir' ? 'backup' : values.deletionPolicy,
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
        sourceDeviceId:      srcSaved ? undefined : (values.sourceDeviceId || undefined),
        destinationDeviceId: dstSaved ? undefined : (values.destinationDeviceId || undefined),
        watch:    values.watch,
        schedule: values.schedule || undefined,
        autoOptions: {
          fileChangeDelaySec: values.watch ? values.fileChangeDelaySec : undefined,
          onFolderConnect: values.onFolderConnect,
          onStart: values.onStart,
          periodicEveryMinutes: periodicEveryMinutes && periodicEveryMinutes > 0 ? periodicEveryMinutes : undefined,
          onLogoff: values.onLogoff,
          unattended: values.unattended,
          skipIfChangedPercent: values.skipIfChangedPercentEnabled ? values.skipIfChangedPercent : undefined,
          waitForLocksMinutes: values.waitForLocksEnabled ? values.waitForLocksMinutes : undefined,
          autoClearTreeAfterSync: values.autoClearTreeAfterSync,
        },
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
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col overflow-hidden" style={{ height: 640 }}>
      <div className="flex flex-1 overflow-hidden">
        <NavRail active={pane} setActive={setPane} scheduleTriggerCount={scheduleTriggerCount} />

        <div className="flex-1 overflow-y-auto p-6">
          {pane === 'paths' && (
            <SourceDestPane
              job={job}
              isSync={isSync}
              srcSaved={srcSaved}
              dstSaved={dstSaved}
              setSrcSaved={setSrcSaved}
              setDstSaved={setDstSaved}
              endpoints={endpoints}
              control={control}
              watch={watch}
              setValue={setValue}
              errors={errors}
              register={register}
            />
          )}
          {pane === 'schedule' && (
            <SchedulePane
              watch={watch}
              setValue={setValue}
              register={register}
            />
          )}
          {pane === 'general' && (
            <GeneralPane
              watch={watch}
              setValue={setValue}
              register={register}
              errors={errors}
            />
          )}
          {!['paths', 'schedule', 'general'].includes(pane) && (
            <PlaceholderPane id={pane} />
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t px-5 py-3 flex items-center gap-3 shrink-0">
        {job && (
          <Button type="button" variant="outline" size="sm">
            ▶ Run now
          </Button>
        )}
        {errors.root && (
          <p className="flex-1 text-xs text-destructive">{errors.root.message}</p>
        )}
        {!errors.root && <span className="flex-1" />}
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
