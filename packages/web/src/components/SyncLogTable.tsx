import { useState } from 'react'
import { CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight, RotateCcw, Loader2, Ban } from 'lucide-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatRelative, formatDuration, formatBytes } from '@/lib/format'

export interface SyncLogEntry {
  id:               string
  job_id:           string
  status:           'completed' | 'error' | 'cancelled'
  error_message:    string | null
  started_at:       number
  ended_at:         number | null
  files_copied:     number
  files_deleted:    number
  files_skipped:    number
  files_errored:    number
  bytes_transferred: number
  logical_bytes:    number
  delta_bytes:      number
  full_bytes:       number
  delta_files:      number
  full_files:       number
  transport_mode?:  string | null
  errors:           string   // JSON array of per-file error strings
  rollback_status?: 'none' | 'available' | 'used' | 'expired' | null
  is_rollback?:     boolean
  rollback_of?:     number | null
}

interface SyncLogTableProps {
  entries:           SyncLogEntry[]
  onRollback?:       (entry: SyncLogEntry) => void
  rollbackingLogId?: string
}

function StatusIcon({ entry }: { entry: SyncLogEntry }) {
  if (entry.status === 'cancelled') {
    return <Ban className="text-slate-400" size={16} />
  }
  if (entry.status === 'error') {
    return <XCircle className="text-destructive" size={16} />
  }
  if (entry.files_errored > 0) {
    return (
      <Tooltip>
        <TooltipTrigger>
          <AlertCircle className="text-amber-500" size={16} />
        </TooltipTrigger>
        <TooltipContent>{entry.files_errored} file{entry.files_errored !== 1 ? 's' : ''} failed</TooltipContent>
      </Tooltip>
    )
  }
  return <CheckCircle2 className="text-green-600" size={16} />
}

export default function SyncLogTable({ entries, onRollback, rollbackingLogId }: SyncLogTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        No sync runs yet.
      </div>
    )
  }

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-6" />
          <TableHead>Started</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Copied</TableHead>
          <TableHead>Deleted</TableHead>
          <TableHead>Skipped</TableHead>
          <TableHead>Transport</TableHead>
          <TableHead>Size</TableHead>
          <TableHead className="w-8" />
          <TableHead className="w-24" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map(entry => {
          const fileErrors: string[] = (() => {
            try { return entry.errors ? JSON.parse(entry.errors) : [] } catch { return [] }
          })()

          // Expandable if there's a fatal error message OR per-file errors
          const expandContent = entry.error_message
            ? [entry.error_message]
            : fileErrors

          const isExpandable = expandContent.length > 0
          const isExpanded   = expanded.has(entry.id)
          const duration     = entry.ended_at ? entry.ended_at - entry.started_at : null

          const isRollbackRow = entry.is_rollback === true
          const canRollback  = !isRollbackRow && entry.rollback_status === 'available' && !!onRollback
          const isRollingBack = rollbackingLogId === entry.id

          return [
            <TableRow
              key={entry.id}
              className={[
                isExpandable ? 'cursor-pointer select-none' : '',
                isRollbackRow ? 'bg-violet-50 dark:bg-violet-950/20' : '',
              ].filter(Boolean).join(' ')}
              onClick={isExpandable && !isRollbackRow ? () => toggle(entry.id) : undefined}
            >
              {/* Expand chevron */}
              <TableCell className="pr-0 text-muted-foreground">
                {isRollbackRow
                  ? <RotateCcw size={13} className="text-violet-500" />
                  : isExpandable
                    ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)
                    : null}
              </TableCell>

              {/* Started */}
              <TableCell>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-sm cursor-default">
                      {formatRelative(entry.started_at)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {new Date(entry.started_at).toLocaleString()}
                  </TooltipContent>
                </Tooltip>
              </TableCell>

              {/* Duration */}
              <TableCell className="text-sm text-muted-foreground">
                {duration != null ? formatDuration(duration) : '—'}
              </TableCell>

              {/* Copied */}
              <TableCell className="text-sm">{entry.files_copied}</TableCell>

              {/* Deleted */}
              <TableCell className="text-sm">{entry.files_deleted ?? 0}</TableCell>

              {/* Skipped */}
              <TableCell className="text-sm text-muted-foreground">{entry.files_skipped}</TableCell>

              {/* Transport */}
              <TableCell className="text-sm">
                {entry.transport_mode === 'relay' ? (
                  <Badge variant="outline" className="border-blue-300 text-blue-600 text-xs">relay</Badge>
                ) : entry.transport_mode === 'local' ? (
                  <span className="text-xs text-muted-foreground">local</span>
                ) : null}
              </TableCell>

              {/* Size */}
              <TableCell className="text-sm">
                {entry.bytes_transferred > 0 ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-default">{formatBytes(entry.bytes_transferred)}</span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {(() => {
                        const parts: string[] = []
                        if (entry.logical_bytes > 0) {
                          parts.push(`${formatBytes(entry.bytes_transferred)} network`)
                          parts.push(`${formatBytes(entry.logical_bytes)} logical`)
                        } else {
                          parts.push('Network bytes transferred')
                        }
                        const totalFiles = (entry.delta_files ?? 0) + (entry.full_files ?? 0)
                        if ((entry.delta_files ?? 0) > 0 && totalFiles > 0) {
                          const pct = Math.round((entry.delta_files! / totalFiles) * 100)
                          parts.push(`${pct}% delta`)
                        }
                        return parts.join(' · ')
                      })()}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>

              {/* Status icon */}
              <TableCell>
                {isRollbackRow
                  ? <Badge variant="outline" className="border-violet-300 text-violet-600 text-xs">rollback</Badge>
                  : <StatusIcon entry={entry} />}
              </TableCell>

              {/* Rollback action */}
              <TableCell onClick={e => e.stopPropagation()}>
                {canRollback && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    disabled={isRollingBack}
                    onClick={() => onRollback(entry)}
                  >
                    {isRollingBack
                      ? <Loader2 size={12} className="animate-spin" />
                      : <RotateCcw size={12} />}
                    Rollback
                  </Button>
                )}
              </TableCell>
            </TableRow>,

            /* Expandable error panel */
            isExpanded && !isRollbackRow && (
              <TableRow key={`${entry.id}-detail`} className="hover:bg-transparent">
                <TableCell colSpan={10} className="pt-0 pb-2 px-4">
                  <pre className="overflow-auto max-h-32 rounded-md bg-destructive/5 border border-destructive/20 px-3 py-2 font-mono text-xs text-destructive leading-relaxed whitespace-pre-wrap">
                    {expandContent.join('\n')}
                  </pre>
                </TableCell>
              </TableRow>
            ),
          ]
        })}
      </TableBody>
    </Table>
  )
}
