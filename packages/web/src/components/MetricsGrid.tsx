import { useNavigate } from 'react-router-dom'
import { Activity, CheckCircle2, HardDrive, Files, Play } from 'lucide-react'
import { formatBytes } from '@/lib/format'
import type { Job } from '@/types'
import type { AnalyticsData } from '@/lib/api'

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

interface MetricCardProps {
  icon: React.ElementType
  label: string
  value: string
  sub?: string
  valueColor?: string
  onClick?: () => void
}

function MetricCard({ icon: Icon, label, value, sub, valueColor, onClick }: MetricCardProps) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      onClick={onClick}
      className={`rounded-lg border bg-card p-4 text-left space-y-1.5 w-full transition-colors ${
        onClick ? 'hover:bg-muted/40 cursor-pointer' : 'cursor-default'
      }`}
    >
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        <Icon size={13} />
        {label}
      </div>
      <p className={`text-2xl font-semibold tabular-nums ${valueColor ?? ''}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </Comp>
  )
}

interface Props {
  jobs: Job[]
  analytics: AnalyticsData | undefined
}

export default function MetricsGrid({ jobs, analytics }: Props) {
  const navigate = useNavigate()
  const summary = analytics?.summary

  const running = jobs.filter(j => j.status === 'running' || j.status === 'queued').length
  const successRate =
    summary && summary.totalRuns > 0
      ? Math.round((summary.successfulRuns / summary.totalRuns) * 100)
      : null

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <MetricCard
        icon={Play}
        label="Running now"
        value={String(running)}
        sub={running === 0 ? 'All idle' : `${running} job${running > 1 ? 's' : ''} active`}
        valueColor={running > 0 ? 'text-amber-600' : undefined}
        onClick={() => navigate('/jobs?status=running')}
      />
      <MetricCard
        icon={Activity}
        label="Total runs (7d)"
        value={summary ? fmtNum(summary.totalRuns) : '—'}
        sub={summary ? `${fmtNum(summary.successfulRuns)} successful` : undefined}
      />
      <MetricCard
        icon={CheckCircle2}
        label="Success rate"
        value={successRate != null ? `${successRate}%` : '—'}
        valueColor={
          successRate == null
            ? undefined
            : successRate < 90
            ? 'text-amber-600'
            : 'text-green-600'
        }
        onClick={summary?.errorRuns ? () => navigate('/jobs?status=error') : undefined}
      />
      <MetricCard
        icon={HardDrive}
        label="Data moved (7d)"
        value={summary ? formatBytes(summary.totalBytesTransferred) : '—'}
      />
      <MetricCard
        icon={Files}
        label="Files synced (7d)"
        value={summary ? fmtNum(summary.totalFilesCopied) : '—'}
        sub={
          summary?.totalFilesDeleted
            ? `${fmtNum(summary.totalFilesDeleted)} deleted`
            : undefined
        }
      />
    </div>
  )
}
