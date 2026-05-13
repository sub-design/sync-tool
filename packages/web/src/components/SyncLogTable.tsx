import { useState } from 'react'
import { Check, X } from 'lucide-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatRelative, formatDuration, formatBytes } from '@/lib/format'

interface LogEntry {
  id: string
  started_at: number
  ended_at?: number
  files_copied?: number
  files_skipped?: number
  bytes_transferred?: number
  logical_bytes?: number
  delta_bytes?: number
  full_bytes?: number
  delta_files?: number
  full_files?: number
  errors?: string
  status: 'completed' | 'error' | string
}

interface SyncLogTableProps {
  entries: LogEntry[]
  jobId: string
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

  function toggleRow(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Started</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Copied</TableHead>
          <TableHead>Skipped</TableHead>
          <TableHead>Size</TableHead>
          <TableHead className="w-8">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map(entry => {
          const parsedErrors: string[] = (() => {
            try { return entry.errors ? JSON.parse(entry.errors) : [] } catch { return [] }
          })()
          const hasErrors = parsedErrors.length > 0
          const isExpanded = expanded.has(entry.id)
          const duration = entry.ended_at ? entry.ended_at - entry.started_at : 0
          const absoluteDate = new Date(entry.started_at).toLocaleString()

          return [
            <TableRow
              key={entry.id}
              className={hasErrors ? 'cursor-pointer' : undefined}
              onClick={hasErrors ? () => toggleRow(entry.id) : undefined}
            >
              <TableCell>
                <Tooltip>
                  <TooltipTrigger className="text-sm">
                    {formatRelative(entry.started_at)}
                  </TooltipTrigger>
                  <TooltipContent>{absoluteDate}</TooltipContent>
                </Tooltip>
              </TableCell>
              <TableCell className="text-sm">{formatDuration(duration)}</TableCell>
              <TableCell className="text-sm">{entry.files_copied ?? 0}</TableCell>
              <TableCell className="text-sm">{entry.files_skipped ?? 0}</TableCell>
              <TableCell className="text-sm">
                <Tooltip>
                  <TooltipTrigger>
                    {entry.bytes_transferred ? formatBytes(entry.bytes_transferred) : '—'}
                  </TooltipTrigger>
                  <TooltipContent>
                    {entry.logical_bytes
                      ? `${formatBytes(entry.bytes_transferred ?? 0)} network / ${formatBytes(entry.logical_bytes)} logical`
                      : 'Network bytes transferred'}
                    {(entry.delta_files ?? 0) > 0 && ` · ${entry.delta_files} delta files`}
                    {(entry.full_files ?? 0) > 0 && ` · ${entry.full_files} full files`}
                  </TooltipContent>
                </Tooltip>
              </TableCell>
              <TableCell>
                {entry.status === 'completed'
                  ? <Check className="text-green-600" size={16} />
                  : <X className="text-red-500" size={16} />}
              </TableCell>
            </TableRow>,

            isExpanded && (
              <TableRow key={`${entry.id}-errors`}>
                <TableCell colSpan={6} className="p-0">
                  <ScrollArea className="max-h-[120px]">
                    <pre className="bg-red-50 dark:bg-red-950 font-mono text-xs p-2 rounded">
                      {parsedErrors.join('\n')}
                    </pre>
                  </ScrollArea>
                </TableCell>
              </TableRow>
            ),
          ]
        })}
      </TableBody>
    </Table>
  )
}
