import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Activity, HardDrive, Files, CheckCircle2, XCircle, TrendingUp,
} from 'lucide-react'
import Shell from '@/components/Shell'
import { getAnalytics, type DailyActivity, type JobStat } from '@/lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (n === 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(n) / Math.log(1024))
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function pct(a: number, b: number): string {
  if (b === 0) return '—'
  return `${Math.round((a / b) * 100)}%`
}

// ── Inline SVG bar chart ──────────────────────────────────────────────────────

function ActivityChart({ data }: { data: DailyActivity[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        No activity yet
      </div>
    )
  }

  const W = 720, H = 80, pad = { t: 4, b: 24, l: 0, r: 0 }
  const innerW = W - pad.l - pad.r
  const innerH = H - pad.t - pad.b

  // Fill in gaps so every day in range is represented
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date))
  const byDate = Object.fromEntries(sorted.map(d => [d.date, d]))
  const first  = new Date(sorted[0].date)
  const last   = new Date(sorted[sorted.length - 1].date)
  const days: DailyActivity[] = []
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10)
    days.push(byDate[key] ?? { date: key, runs: 0, errors: 0, bytes: 0 })
  }

  const maxRuns = Math.max(...days.map(d => d.runs), 1)
  const barW    = innerW / days.length
  const gap     = Math.max(1, barW * 0.15)

  // Show ~6 date labels evenly spaced
  const labelStep = Math.max(1, Math.floor(days.length / 6))

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ minWidth: 300 }}
        aria-label="Daily sync activity"
      >
        {days.map((day, i) => {
          const barH  = (day.runs / maxRuns) * innerH
          const errH  = day.runs > 0 ? (day.errors / day.runs) * barH : 0
          const okH   = barH - errH
          const x     = pad.l + i * barW + gap / 2
          const w     = barW - gap

          return (
            <g key={day.date}>
              {/* success portion */}
              {okH > 0 && (
                <rect
                  x={x} y={pad.t + innerH - barH} width={w} height={okH}
                  rx={2}
                  className="fill-primary/70"
                />
              )}
              {/* error portion stacked on top */}
              {errH > 0 && (
                <rect
                  x={x} y={pad.t + innerH - barH + okH} width={w} height={errH}
                  rx={2}
                  className="fill-destructive/70"
                />
              )}
              {/* date label */}
              {i % labelStep === 0 && (
                <text
                  x={x + w / 2} y={H - 4}
                  textAnchor="middle"
                  fontSize={9}
                  className="fill-muted-foreground"
                >
                  {day.date.slice(5)} {/* MM-DD */}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-primary/70" />
          Successful
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-destructive/70" />
          Errors
        </span>
      </div>
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, sub, color = 'text-foreground',
}: {
  icon: React.ElementType
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <div className="rounded-lg border p-4 space-y-2">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        <Icon size={13} />
        {label}
      </div>
      <p className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

// ── Job row ───────────────────────────────────────────────────────────────────

function JobRow({ job, maxBytes }: { job: JobStat; maxBytes: number }) {
  const barPct = maxBytes > 0 ? (job.totalBytes / maxBytes) * 100 : 0
  return (
    <tr className="border-b last:border-0 text-sm hover:bg-muted/30 transition-colors">
      <td className="py-2.5 pl-4 pr-2 font-medium max-w-[200px] truncate">
        <Link to={`/jobs/${job.jobId}`} className="hover:underline underline-offset-2">
          {job.jobName}
        </Link>
      </td>
      <td className="py-2.5 px-2 tabular-nums text-right">{job.runs}</td>
      <td className="py-2.5 px-2 tabular-nums text-right">
        <span className={job.runs > 0 && job.successfulRuns < job.runs ? 'text-destructive' : ''}>
          {pct(job.successfulRuns, job.runs)}
        </span>
      </td>
      <td className="py-2.5 px-2 tabular-nums text-right">{fmtNum(job.totalFiles)}</td>
      <td className="py-2.5 px-2 pr-4 min-w-[160px]">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary/60"
              style={{ width: `${barPct}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground w-16 text-right">
            {fmtBytes(job.totalBytes)}
          </span>
        </div>
      </td>
      <td className="py-2.5 px-2 pr-4 text-xs text-muted-foreground whitespace-nowrap">
        {job.lastRun ? new Date(job.lastRun).toLocaleDateString() : '—'}
      </td>
    </tr>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { label: '7 days',  value: 7  },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
]

export default function Analytics() {
  const [days, setDays] = useState(30)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['analytics', days],
    queryFn:  () => getAnalytics(days),
    staleTime: 2 * 60_000,
  })

  const summary = data?.summary
  const maxBytes = Math.max(...(data?.byJob.map(j => j.totalBytes) ?? [0]), 1)

  return (
    <Shell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Analytics</h1>
            <p className="text-sm text-muted-foreground">
              Sync activity across all jobs in this org
            </p>
          </div>
          <div className="flex gap-1 border rounded-md p-0.5 text-sm">
            {PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setDays(opt.value)}
                className={[
                  'px-3 py-1 rounded transition-colors',
                  days === opt.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {isError && (
          <p className="text-sm text-destructive">Failed to load analytics.</p>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            icon={Activity}
            label="Total runs"
            value={isLoading ? '…' : fmtNum(summary?.totalRuns ?? 0)}
            sub={`last ${days}d`}
          />
          <StatCard
            icon={CheckCircle2}
            label="Success rate"
            value={isLoading ? '…' : pct(summary?.successfulRuns ?? 0, summary?.totalRuns ?? 0)}
            sub={`${summary?.successfulRuns ?? 0} / ${summary?.totalRuns ?? 0} runs`}
            color={(summary?.errorRuns ?? 0) > 0 ? 'text-amber-600' : 'text-green-600'}
          />
          <StatCard
            icon={XCircle}
            label="Errors"
            value={isLoading ? '…' : fmtNum(summary?.errorRuns ?? 0)}
            color={(summary?.errorRuns ?? 0) > 0 ? 'text-destructive' : 'text-foreground'}
          />
          <StatCard
            icon={HardDrive}
            label="Data moved"
            value={isLoading ? '…' : fmtBytes(summary?.totalBytesTransferred ?? 0)}
          />
          <StatCard
            icon={Files}
            label="Files copied"
            value={isLoading ? '…' : fmtNum(summary?.totalFilesCopied ?? 0)}
          />
          <StatCard
            icon={TrendingUp}
            label="Files deleted"
            value={isLoading ? '…' : fmtNum(summary?.totalFilesDeleted ?? 0)}
            sub="by mirror/backup-delete policy"
          />
        </div>

        {/* Activity chart */}
        <div className="border rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-medium">Daily activity</h2>
          {isLoading
            ? <div className="h-20 bg-muted/30 rounded animate-pulse" />
            : <ActivityChart data={data?.dailyActivity ?? []} />
          }
        </div>

        {/* Per-job table */}
        {((data?.byJob.length ?? 0) > 0) && (
          <div className="border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b">
              <h2 className="text-sm font-medium">Jobs breakdown</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b bg-muted/30">
                    <th className="text-left py-2 pl-4 pr-2 font-medium">Job</th>
                    <th className="text-right py-2 px-2 font-medium">Runs</th>
                    <th className="text-right py-2 px-2 font-medium">Success</th>
                    <th className="text-right py-2 px-2 font-medium">Files</th>
                    <th className="text-left py-2 px-2 pr-4 font-medium">Data transferred</th>
                    <th className="text-left py-2 px-2 pr-4 font-medium">Last run</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.byJob.map(job => (
                    <JobRow key={job.jobId} job={job} maxBytes={maxBytes} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!isLoading && (data?.byJob.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No sync history yet. Run a job to see analytics.
          </p>
        )}
      </div>
    </Shell>
  )
}
