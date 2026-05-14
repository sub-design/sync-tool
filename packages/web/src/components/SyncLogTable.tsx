import { useState } from 'react'
import { CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatRelative, formatDuration, formatBytes } from '@/lib/format'

export interface SyncLogEntry {
  id:               string
  job_id:           string
  status:           'completed' | 'error'
  error_message:    string | null
  started_at:       number
  ended_at:         number | null
  files_copied:     number
  files_skipped:    number
  files_errored:    number
  bytes_transferred: number
  logical_bytes:    number
  errors:           string   // JSON array of per-file error strings
}

interface SyncLogTableProps {
  entries: SyncLogEntry[]
}

function StatusIcon({ entry }: { entry: SyncLogEntry }) {
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

export default function SyncLogTable({ entries }: SyncLogTableProps) {
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
          <TableHead>Skipped</TableHead>
          <TableHead>Size</TableHead>
          <TableHead className="w-8" />
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

          return [
            <TableRow
              key={entry.id}
              className={isExpandable ? 'cursor-pointer select-none' : undefined}
              onClick={isExpandable ? () => toggle(entry.id) : undefined}
            >
              {/* Expand chevron */}
              <TableCell className="pr-0 text-muted-foreground">
                {isExpandable
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

              {/* Skipped */}
              <TableCell className="text-sm text-muted-foreground">{entry.files_skipped}</TableCell>

              {/* Size */}
              <TableCell className="text-sm">
                {entry.bytes_transferred > 0 ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-default">{formatBytes(entry.bytes_transferred)}</span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {entry.logical_bytes > 0
                        ? `${formatBytes(entry.bytes_transferred)} network · ${formatBytes(entry.logical_bytes)} logical`
                        : 'Network bytes transferred'}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>

              {/* Status icon */}
              <TableCell>
                <StatusIcon entry={entry} />
              </TableCell>
            </TableRow>,

            /* Expandable error panel */
            isExpanded && (
              <TableRow key={`${entry.id}-detail`} className="hover:bg-transparent">
                <TableCell colSpan={7} className="pt-0 pb-2 px-4">
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
