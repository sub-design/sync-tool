import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Download,
  Info,
  Lock,
  Minus,
  RotateCcw,
  Upload,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { formatDuration, formatBytes, formatAbsolute } from '@/lib/format'
import type { SyncLogEntry } from '@/components/SyncLogTable'

// ── helpers ───────────────────────────────────────────────────────────────────

function parseErrors(raw: string): string[] {
  try { return JSON.parse(raw) ?? [] } catch { return [] }
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 py-0.5 text-sm" style={{ gridTemplateColumns: '120px 1fr' }}>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{children}</span>
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────

interface RunDetailsPanelProps {
  entry: SyncLogEntry | null
  onClose: () => void
  onRollback?: (entry: SyncLogEntry) => void
  rollbackingLogId?: string
}

export default function RunDetailsPanel({
  entry,
  onClose,
  onRollback,
  rollbackingLogId,
}: RunDetailsPanelProps) {
  if (!entry) return null

  const duration    = entry.ended_at ? entry.ended_at - entry.started_at : null
  const fileErrors  = parseErrors(entry.errors)
  const allErrors   = [
    ...(entry.error_message ? [entry.error_message] : []),
    ...fileErrors,
  ]
  const isRollback  = entry.is_rollback === true
  const canRollback = !isRollback && entry.rollback_status === 'available' && !!onRollback
  const isRollingBack = rollbackingLogId === entry.id

  const title = isRollback
    ? `↩ Rollback run`
    : `Sync run · ${formatAbsolute(entry.started_at)}`

  return (
    <Sheet open={entry !== null} onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-[440px]">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="text-base">{title}</SheetTitle>
          <p className="text-sm text-muted-foreground">
            {new Date(entry.started_at).toLocaleString()}
          </p>
        </SheetHeader>

        <div className="px-5 pb-8">
          {/* Summary */}
          <SectionTitle>Summary</SectionTitle>
          <div className="space-y-1.5">
            <Row label="Status">
              {entry.status === 'completed' && entry.files_errored === 0 && (
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-green-600" />
                  Completed
                </span>
              )}
              {entry.status === 'completed' && entry.files_errored > 0 && (
                <span className="flex items-center gap-1.5 text-amber-600">
                  <AlertTriangle size={14} />
                  Completed with errors
                </span>
              )}
              {entry.status === 'error' && (
                <span className="flex items-center gap-1.5 text-destructive">
                  <XCircle size={14} />
                  Failed
                </span>
              )}
              {entry.status === 'cancelled' && (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Ban size={14} />
                  Cancelled
                </span>
              )}
            </Row>
            {duration != null && (
              <Row label="Duration">{formatDuration(duration)}</Row>
            )}
            {entry.transport_mode && (
              <Row label="Transport">{entry.transport_mode}</Row>
            )}
            {isRollback && (
              <Row label="Type">Rollback</Row>
            )}
          </div>

          {/* Files changed */}
          <SectionTitle>Files</SectionTitle>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm">
              <Upload size={14} className="text-muted-foreground" />
              <span className="tabular-nums text-foreground">{entry.files_copied}</span>
              <span className="text-muted-foreground">copied</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Download size={14} className="text-muted-foreground" />
              <span className="tabular-nums text-foreground">{entry.files_deleted ?? 0}</span>
              <span className="text-muted-foreground">deleted</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Minus size={14} className="text-muted-foreground" />
              <span className="tabular-nums text-foreground">{entry.files_skipped}</span>
              <span className="text-muted-foreground">skipped</span>
            </div>
            {entry.files_errored > 0 && (
              <div className="flex items-center gap-2 text-sm text-amber-600">
                <AlertTriangle size={14} />
                <span className="tabular-nums">{entry.files_errored}</span>
                <span>errored</span>
              </div>
            )}
          </div>

          {/* Transfer */}
          {entry.bytes_transferred > 0 && (
            <>
              <SectionTitle>Transfer</SectionTitle>
              <div className="space-y-1.5 text-sm">
                <Row label="Network">{formatBytes(entry.bytes_transferred)}</Row>
                {entry.logical_bytes > 0 && (
                  <Row label="Logical">{formatBytes(entry.logical_bytes)}</Row>
                )}
                {(entry.delta_files ?? 0) > 0 && (
                  <Row label="Delta files">
                    {entry.delta_files} of {(entry.delta_files ?? 0) + (entry.full_files ?? 0)} files
                    {' '}({Math.round(((entry.delta_files ?? 0) / ((entry.delta_files ?? 0) + (entry.full_files ?? 0))) * 100)}%)
                  </Row>
                )}
              </div>
            </>
          )}

          {/* Errors */}
          {allErrors.length > 0 && (
            <>
              <SectionTitle>Errors ({allErrors.length})</SectionTitle>
              <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
                <ul className="space-y-1.5">
                  {allErrors.map((err, i) => (
                    <li key={i} className="font-mono text-xs text-destructive break-all">{err}</li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {/* Rollback */}
          {!isRollback && (
            <>
              <SectionTitle>Rollback</SectionTitle>
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                {canRollback && (
                  <div className="flex items-center gap-1.5 text-foreground">
                    <CheckCircle2 size={14} />
                    <span className="font-medium">Available</span>
                  </div>
                )}
                {entry.rollback_status === 'used' && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <RotateCcw size={14} />
                    <span>Already rolled back</span>
                  </div>
                )}
                {entry.rollback_status === 'expired' && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Lock size={14} />
                    <span>Rollback window expired</span>
                  </div>
                )}
                {(!entry.rollback_status || entry.rollback_status === 'none') && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Info size={14} />
                    <span>Rollback unavailable — history was not enabled at run time</span>
                  </div>
                )}
              </div>

              {canRollback && (
                <div className="mt-4">
                  <Button
                    className="w-full gap-2"
                    disabled={isRollingBack}
                    onClick={() => onRollback!(entry)}
                  >
                    <RotateCcw size={14} />
                    {isRollingBack ? 'Rolling back…' : 'Rollback from this run'}
                  </Button>
                </div>
              )}
            </>
          )}

          {isRollback && (
            <div className="mt-5 flex items-start gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              <Info size={14} className="mt-0.5 shrink-0" />
              This rollback run cannot itself be rolled back.
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
