import { useState, useMemo } from 'react'
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import { formatBytes, formatRelative } from '@/lib/format'
import type { SyncFileAction, SyncLogFile } from '@/types'
import type { SyncFileEvent } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FileRow {
  relativePath: string
  isDirectory:  boolean
  action:       SyncFileAction
  size:         number | null
  mtimeMs:      number | null
  errorMsg?:    string | null
}

function fromSyncLogFile(f: SyncLogFile): FileRow {
  return {
    relativePath: f.relative_path,
    isDirectory:  f.is_directory,
    action:       f.action,
    size:         f.size,
    mtimeMs:      f.mtime_ms,
    errorMsg:     f.error_msg,
  }
}

function fromSyncFileEvent(f: SyncFileEvent): FileRow {
  return {
    relativePath: f.relativePath,
    isDirectory:  f.isDirectory,
    action:       f.action,
    size:         f.size,
    mtimeMs:      f.mtimeMs,
    errorMsg:     f.errorMsg,
  }
}

// ── Tree node ─────────────────────────────────────────────────────────────────

interface TreeNode {
  name:     string
  path:     string
  children: Map<string, TreeNode>
  file?:    FileRow
}

function buildTree(files: FileRow[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map() }

  for (const file of files) {
    const parts = file.relativePath.replace(/\\/g, '/').split('/').filter(Boolean)
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const nodePath = parts.slice(0, i + 1).join('/')
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, path: nodePath, children: new Map() })
      }
      node = node.children.get(part)!
      if (i === parts.length - 1) {
        node.file = file
      }
    }
  }

  return root
}

// ── Action badge ──────────────────────────────────────────────────────────────

const ACTION_STYLE: Record<SyncFileAction, string> = {
  copied:  'text-emerald-600 dark:text-emerald-400',
  deleted: 'text-red-500 dark:text-red-400',
  skipped: 'text-muted-foreground',
  errored: 'text-orange-500 dark:text-orange-400',
}

const ACTION_LABEL: Record<SyncFileAction, string> = {
  copied:  'copied',
  deleted: 'deleted',
  skipped: 'skipped',
  errored: 'error',
}

// ── Single node row ───────────────────────────────────────────────────────────

const MAX_VISIBLE = 2000

function NodeRow({
  node,
  depth,
  defaultOpen,
}: {
  node: TreeNode
  depth: number
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const isDir = node.children.size > 0 || node.file?.isDirectory
  const f = node.file

  const indent = depth * 16

  // Sort children: dirs first, then files, both alphabetically
  const sorted = useMemo(() => {
    const entries = [...node.children.values()]
    return entries.sort((a, b) => {
      const aDir = a.children.size > 0 || a.file?.isDirectory
      const bDir = b.children.size > 0 || b.file?.isDirectory
      if (aDir !== bDir) return aDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [node.children])

  return (
    <>
      <div
        className="flex items-center gap-1.5 px-3 py-[3px] text-sm hover:bg-muted/50 group"
        style={{ paddingLeft: `${12 + indent}px` }}
      >
        {/* Expand chevron */}
        <span className="w-4 flex-shrink-0 text-muted-foreground">
          {isDir ? (
            <button onClick={() => setOpen(v => !v)} className="flex items-center">
              {open
                ? <ChevronDown className="h-3.5 w-3.5" />
                : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : null}
        </span>

        {/* Icon */}
        <span className="flex-shrink-0 text-muted-foreground">
          {isDir
            ? (open ? <FolderOpen className="h-4 w-4 text-amber-500" /> : <Folder className="h-4 w-4 text-amber-500" />)
            : <File className="h-4 w-4" />}
        </span>

        {/* Name */}
        <span className="flex-1 min-w-0 truncate font-mono text-xs">{node.name}</span>

        {/* Action */}
        {f && !f.isDirectory && (
          <span className={`flex-shrink-0 text-xs tabular-nums ${ACTION_STYLE[f.action]}`}>
            {ACTION_LABEL[f.action]}
          </span>
        )}

        {/* Size */}
        <span className="flex-shrink-0 w-20 text-right text-xs text-muted-foreground tabular-nums">
          {f && !f.isDirectory && f.size != null ? formatBytes(f.size) : ''}
        </span>

        {/* Date */}
        <span className="flex-shrink-0 w-24 text-right text-xs text-muted-foreground tabular-nums">
          {f?.mtimeMs ? formatRelative(f.mtimeMs) : ''}
        </span>
      </div>

      {/* Error message */}
      {f?.errorMsg && (
        <div
          className="px-3 py-0.5 text-xs text-orange-500 dark:text-orange-400 font-mono truncate"
          style={{ paddingLeft: `${12 + indent + 36}px` }}
          title={f.errorMsg}
        >
          {f.errorMsg}
        </div>
      )}

      {/* Children */}
      {isDir && open && sorted.map(child => (
        <NodeRow key={child.path} node={child} depth={depth + 1} defaultOpen={depth < 1} />
      ))}
    </>
  )
}

// ── Main FileTree component ────────────────────────────────────────────────────

interface FileTreeProps {
  files:    SyncLogFile[] | SyncFileEvent[]
  loading?: boolean
  live?:    boolean
}

function isSyncLogFile(f: SyncLogFile | SyncFileEvent): f is SyncLogFile {
  return 'relative_path' in f
}

export default function FileTree({ files, loading, live }: FileTreeProps) {
  const rows: FileRow[] = useMemo(
    () => files.map(f => isSyncLogFile(f) ? fromSyncLogFile(f) : fromSyncFileEvent(f)),
    [files],
  )

  const tree = useMemo(() => buildTree(rows), [rows])

  const sorted = useMemo(() => {
    const entries = [...tree.children.values()]
    return entries.sort((a, b) => {
      const aDir = a.children.size > 0 || a.file?.isDirectory
      const bDir = b.children.size > 0 || b.file?.isDirectory
      if (aDir !== bDir) return aDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [tree.children])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        Loading files…
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        {live ? 'Waiting for file events…' : 'No file records for this run.'}
      </div>
    )
  }

  // Summary counts
  const counts = rows.reduce(
    (acc, f) => { acc[f.action] = (acc[f.action] ?? 0) + 1; return acc },
    {} as Record<SyncFileAction, number>,
  )

  return (
    <div className="rounded-md border overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 px-3 py-2 bg-muted/40 border-b text-xs text-muted-foreground">
        <span className="flex-1">{rows.length.toLocaleString()} items{live ? ' (live)' : ''}</span>
        {counts.copied  > 0 && <span className="text-emerald-600 dark:text-emerald-400">{counts.copied} copied</span>}
        {counts.deleted > 0 && <span className="text-red-500 dark:text-red-400">{counts.deleted} deleted</span>}
        {counts.skipped > 0 && <span className="text-muted-foreground">{counts.skipped} skipped</span>}
        {counts.errored > 0 && <span className="text-orange-500">{counts.errored} errors</span>}
        <span className="w-20 text-right">Size</span>
        <span className="w-24 text-right">Modified</span>
      </div>

      {/* Tree rows */}
      <div className="overflow-auto max-h-[600px] divide-y divide-border/30">
        {sorted.slice(0, MAX_VISIBLE).map(node => (
          <NodeRow key={node.path} node={node} depth={0} defaultOpen={true} />
        ))}
        {sorted.length > MAX_VISIBLE && (
          <div className="px-3 py-2 text-xs text-muted-foreground text-center">
            Showing first {MAX_VISIBLE.toLocaleString()} of {rows.length.toLocaleString()} items
          </div>
        )}
      </div>
    </div>
  )
}
