import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Activity, HardDrive, Files, CheckCircle2, XCircle, TrendingUp,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
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

// ── Recharts bar chart ────────────────────────────────────────────────────────

interface ChartDataPoint {
  date: string
  label: string
  successful: number
  errors: number
}

function ActivityChart({ data }: { data: DailyActivity[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        No activity yet
      </div>
    )
  }

  // Fill gaps so every day in range is represented
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date))
  const byDate = Object.fromEntries(sorted.map(d => [d.date, d]))
  const first  = new Date(sorted[0].date)
  const last   = new Date(sorted[sorted.length - 1].date)
  const days: ChartDataPoint[] = []
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10)
    const entry = byDate[key] ?? { date: key, runs: 0, errors: 0, bytes: 0 }
    days.push({
      date: key,
      label: key.slice(5), // MM-DD
      successful: Math.max(0, entry.runs - entry.errors),
      errors: entry.errors,
    })
  }

  // Only show every N-th label to avoid crowding
  const labelStep = Math.max(1, Math.floor(days.length / 7))

  return (
    <div className="w-full h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={days}
          margin={{ top: 4, right: 8, left: -20, bottom: 4 }}
          barSize={Math.max(4, Math.min(20, 400 / days.length))}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="text-muted-foreground"
            interval={labelStep - 1}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="text-muted-foreground"
            allowDecimals={false}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const succ = (payload.find(p => p.dataKey === 'successful')?.value as number) ?? 0
              const err  = (payload.find(p => p.dataKey === 'errors')?.value as number) ?? 0
              return (
                <div className="rounded-lg border bg-background px-3 py-2 shadow-md text-xs">
                  <p className="font-medium mb-1">{label}</p>
                  <p className="text-green-600">{succ} successful</p>
                  {err > 0 && <p className="text-destructive">{err} error{err > 1 ? 's' : ''}</p>}
                </div>
              )
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            formatter={(value: string) => value === 'successful' ? 'Successful' : 'Errors'}
          />
          <Bar dataKey="successful" stackId="a" className="fill-primary/70" radius={[0, 0, 0, 0]} />
          <Bar dataKey="errors"     stackId="a" className="fill-destructive/70" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
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
            ? <div className="h-[200px] bg-muted/30 rounded animate-pulse" />
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
