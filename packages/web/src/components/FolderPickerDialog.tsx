import { useState, useCallback, type FormEvent } from 'react'
import {
  ChevronRight, ChevronDown, Folder, FolderOpen,
  HardDrive, ChevronLeft, Home, Loader2, AlertCircle,
  Check, Monitor, Download, FileText, Image, Film, Music,
  FolderPlus, RefreshCw, X
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { invalidateBrowseCache, useBrowse } from '@/hooks/useBrowse'
import { createBrowseFolder } from '@/lib/api'
import { useWsStore } from '@/lib/ws'
import type { DirEntry } from '../types'

// ── Favorites sidebar section ──────────────────────────────────────────────────

const FAVORITES = [
  { label: 'Home',      path: '~',            Icon: Home     },
  { label: 'Desktop',   path: '~/Desktop',    Icon: Monitor  },
  { label: 'Documents', path: '~/Documents',  Icon: FileText },
  { label: 'Downloads', path: '~/Downloads',  Icon: Download },
  { label: 'Pictures',  path: '~/Pictures',   Icon: Image    },
  { label: 'Movies',    path: '~/Movies',     Icon: Film     },
  { label: 'Music',     path: '~/Music',      Icon: Music    },
]

function FavoritesSection({ activePath, onNavigate }: { activePath: string; onNavigate: (p: string) => void }) {
  return (
    <div className="px-2 pt-2 pb-1">
      <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 select-none">
        Favorites
      </p>
      {FAVORITES.map(({ label, path, Icon }) => (
        <button
          key={path}
          className={[
            'w-full flex items-center gap-2 px-2 py-1 rounded-sm text-sm transition-colors',
            activePath === path
              ? 'bg-primary/15 text-primary font-medium'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          ].join(' ')}
          onClick={() => onNavigate(path)}
        >
          <Icon size={14} className="shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      ))}
      <div className="mt-2 mb-1 mx-2 h-px bg-border" />
    </div>
  )
}

// ── Tree sidebar ───────────────────────────────────────────────────────────────

interface TreeNodeProps {
  entry:     DirEntry
  deviceId:  string
  level:     number
  activePath: string
  onNavigate: (path: string) => void
}

function TreeNode({ entry, deviceId, level, activePath, onNavigate }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const { entries, isLoading } = useBrowse(expanded ? deviceId : undefined, entry.path)
  const subdirs = entries.filter(e => e.type === 'directory')
  const isActive = activePath === entry.path

  const handleClick = () => {
    setExpanded(v => !v)
    onNavigate(entry.path)
  }

  return (
    <div>
      <div
        className={[
          'flex items-center gap-1 py-1 px-2 rounded-sm cursor-pointer select-none text-sm',
          isActive
            ? 'bg-primary/15 text-primary font-medium'
            : 'hover:bg-accent/50 text-muted-foreground hover:text-foreground',
        ].join(' ')}
        style={{ paddingLeft: `${level * 14 + 8}px` }}
        onClick={handleClick}
      >
        <div className="w-4 h-4 flex items-center justify-center shrink-0">
          {isLoading && expanded
            ? <Loader2 size={12} className="animate-spin" />
            : expanded
              ? <ChevronDown size={13} />
              : <ChevronRight size={13} />
          }
        </div>
        {isActive
          ? <FolderOpen size={15} className="shrink-0 text-primary" />
          : <Folder size={15} className="shrink-0" />
        }
        <span className="truncate">{entry.name}</span>
      </div>

      {expanded && subdirs.length > 0 && (
        <div>
          {subdirs.map(child => (
            <TreeNode
              key={child.path}
              entry={child}
              deviceId={deviceId}
              level={level + 1}
              activePath={activePath}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface FolderTreeProps {
  deviceId:   string
  rootPath:   string
  activePath: string
  onNavigate: (path: string) => void
}

function FolderTree({ deviceId, rootPath, activePath, onNavigate }: FolderTreeProps) {
  const { entries, isLoading, error } = useBrowse(deviceId, rootPath)
  const subdirs = entries.filter(e => e.type === 'directory')

  if (isLoading) return (
    <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
      <Loader2 size={13} className="animate-spin" /> Loading…
    </div>
  )

  if (error) return (
    <div className="flex items-center gap-2 p-3 text-xs text-destructive">
      <AlertCircle size={13} /> {error}
    </div>
  )

  return (
    <div className="flex flex-col gap-0.5 px-2 pb-2">
      {subdirs.map(entry => (
        <TreeNode
          key={entry.path}
          entry={entry}
          deviceId={deviceId}
          level={0}
          activePath={activePath}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  )
}

// ── Main folder listing ────────────────────────────────────────────────────────

interface FolderListProps {
  deviceId:   string
  path:       string
  onNavigate: (path: string) => void
}

function FolderList({ deviceId, path, onNavigate }: FolderListProps) {
  const { entries, isLoading, error } = useBrowse(deviceId, path)

  if (isLoading) return (
    <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 size={18} className="animate-spin" /> Loading…
    </div>
  )

  if (error) return (
    <div className="flex flex-1 items-center justify-center gap-2 text-sm text-destructive">
      <AlertCircle size={18} /> {error}
    </div>
  )

  if (entries.length === 0) return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      Empty folder
    </div>
  )

  const dirs  = entries.filter(e => e.type === 'directory')
  const files = entries.filter(e => e.type === 'file')

  return (
    <div className="flex flex-col">
      {dirs.map(entry => (
        <div
          key={entry.path}
          className="flex items-center gap-2.5 px-3 py-2 rounded-md cursor-pointer hover:bg-accent/60 group"
          onDoubleClick={() => onNavigate(entry.path)}
          onClick={() => {}} // single click does nothing in list (dblclick navigates)
        >
          <Folder size={18} className="shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
          <span className="text-sm truncate">{entry.name}</span>
        </div>
      ))}
      {files.length > 0 && (
        <>
          {dirs.length > 0 && <div className="h-px bg-border my-1 mx-3" />}
          {files.map(entry => (
            <div
              key={entry.path}
              className="flex items-center gap-2.5 px-3 py-2 rounded-md opacity-40 cursor-default select-none"
            >
              <div className="size-[18px] shrink-0 flex items-center justify-center">
                <div className="size-3.5 rounded-sm border border-current opacity-60" />
              </div>
              <span className="text-sm truncate text-muted-foreground">{entry.name}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ── Breadcrumb ─────────────────────────────────────────────────────────────────

function Breadcrumb({ path, onNavigate }: { path: string; onNavigate: (p: string) => void }) {
  const sep    = path.includes('\\') ? '\\' : '/'
  const parts  = path.split(sep).filter(Boolean)

  const segments = parts.map((part, i) => {
    const segPath = (path.startsWith(sep) ? sep : '') + parts.slice(0, i + 1).join(sep)
    return { label: part, path: segPath }
  })

  return (
    <div className="flex items-center gap-0.5 text-sm overflow-x-auto">
      <button
        className="p-1 rounded hover:bg-accent transition-colors shrink-0"
        onClick={() => onNavigate(sep)}
        title="Root"
      >
        <HardDrive size={14} className="text-muted-foreground" />
      </button>
      {segments.map(({ label, path: segPath }, i) => (
        <span key={segPath} className="flex items-center gap-0.5 shrink-0">
          <ChevronRight size={13} className="text-muted-foreground" />
          <button
            className={[
              'px-1 py-0.5 rounded hover:bg-accent transition-colors truncate max-w-[160px]',
              i === segments.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground',
            ].join(' ')}
            onClick={() => onNavigate(segPath)}
            title={segPath}
          >
            {label}
          </button>
        </span>
      ))}
    </div>
  )
}

// ── Main dialog ────────────────────────────────────────────────────────────────

export interface FolderPickerDialogProps {
  open:           boolean
  onOpenChange:   (open: boolean) => void
  initialDeviceId?: string
  initialPath?:   string
  onSelect:       (deviceId: string, path: string) => void
}

export function FolderPickerDialog({
  open, onOpenChange, initialDeviceId, initialPath, onSelect,
}: FolderPickerDialogProps) {
  const agentsOnline = useWsStore(s => s.agentsOnline)
  const agents = [...agentsOnline.entries()]

  // Pick the initial device: prefer provided, fallback to first online
  const defaultDeviceId = initialDeviceId ?? agents[0]?.[0] ?? ''
  const defaultPath     = initialPath ?? '~'

  const [deviceId,   setDeviceId]   = useState(defaultDeviceId)
  const [currentPath, setCurrentPath] = useState(defaultPath)
  const [history,    setHistory]    = useState<string[]>([defaultPath])
  const [histIdx,    setHistIdx]    = useState(0)
  const [browseVersion, setBrowseVersion] = useState(0)
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [createLoading, setCreateLoading] = useState(false)

  // When dialog opens, reset to initial values
  const handleOpenChange = (v: boolean) => {
    if (v) {
      const d = initialDeviceId ?? agents[0]?.[0] ?? ''
      const p = initialPath ?? '~'
      setDeviceId(d)
      setCurrentPath(p)
      setHistory([p])
      setHistIdx(0)
      setBrowseVersion(v => v + 1)
      resetCreateFolder()
    }
    onOpenChange(v)
  }

  const resetCreateFolder = useCallback(() => {
    setIsCreatingFolder(false)
    setNewFolderName('')
    setCreateError(null)
    setCreateLoading(false)
  }, [])

  const navigate = useCallback((path: string) => {
    setCurrentPath(path)
    resetCreateFolder()
    setHistory(h => {
      const next = h.slice(0, histIdx + 1)
      next.push(path)
      setHistIdx(next.length - 1)
      return next
    })
  }, [histIdx, resetCreateFolder])

  const goBack = () => {
    if (histIdx > 0) {
      const newIdx = histIdx - 1
      setHistIdx(newIdx)
      setCurrentPath(history[newIdx])
    }
  }

  const goForward = () => {
    if (histIdx < history.length - 1) {
      const newIdx = histIdx + 1
      setHistIdx(newIdx)
      setCurrentPath(history[newIdx])
    }
  }

  const changeDevice = (id: string) => {
    setDeviceId(id)
    const home = '~'
    setCurrentPath(home)
    setHistory([home])
    setHistIdx(0)
    setBrowseVersion(v => v + 1)
    resetCreateFolder()
  }

  const hostname = agentsOnline.get(deviceId) ?? deviceId

  const handleSelect = () => {
    onSelect(deviceId, currentPath)
    onOpenChange(false)
  }

  const refreshCurrentFolder = useCallback(() => {
    if (!deviceId) return
    invalidateBrowseCache(deviceId, currentPath)
    setBrowseVersion(v => v + 1)
  }, [deviceId, currentPath])

  const handleCreateFolder = async (event: FormEvent) => {
    event.preventDefault()
    if (!deviceId || createLoading) return

    const name = newFolderName.trim()
    if (!isValidFolderName(name)) {
      setCreateError('Use a folder name without slashes')
      return
    }

    setCreateLoading(true)
    setCreateError(null)
    try {
      const created = await createBrowseFolder(deviceId, currentPath, name)
      invalidateBrowseCache(deviceId, currentPath)
      resetCreateFolder()
      setBrowseVersion(v => v + 1)
      setCurrentPath(created.path)
      setHistory(h => {
        const next = h.slice(0, histIdx + 1)
        next.push(created.path)
        setHistIdx(next.length - 1)
        return next
      })
      toast.success('Folder created')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create folder'
      setCreateError(message)
      toast.error(message)
    } finally {
      setCreateLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-4xl p-0 overflow-hidden [&>div:first-child]:p-0 [&>div:first-child]:overflow-hidden">
      <div className="flex flex-col h-[600px] overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <DialogTitle className="text-base">Pick a Folder</DialogTitle>

          {/* Device selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 max-w-[200px]">
                <Monitor size={14} className="shrink-0" />
                <span className="truncate">{hostname || 'Select device'}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {agents.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">No agents online</div>
              ) : agents.map(([id, name]) => (
                <DropdownMenuItem
                  key={id}
                  className="flex items-center gap-2"
                  onClick={() => changeDevice(id)}
                >
                  <Monitor size={14} />
                  <span className="truncate flex-1">{name}</span>
                  {id === deviceId && <Check size={13} className="shrink-0" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* ── Navigation bar ── */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30 shrink-0">
          <Button
            variant="ghost" size="icon" className="size-7 shrink-0"
            disabled={histIdx === 0}
            onClick={goBack}
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            variant="ghost" size="icon" className="size-7 shrink-0"
            disabled={histIdx === history.length - 1}
            onClick={goForward}
          >
            <ChevronRight size={16} />
          </Button>
          <Button
            variant="ghost" size="icon" className="size-7 shrink-0"
            onClick={() => navigate('~')}
            title="Home directory"
          >
            <Home size={15} />
          </Button>
          <Button
            variant="ghost" size="icon" className="size-7 shrink-0"
            onClick={refreshCurrentFolder}
            disabled={!deviceId}
            title="Refresh"
          >
            <RefreshCw size={15} />
          </Button>
          <Button
            variant="ghost" size="icon" className="size-7 shrink-0"
            onClick={() => {
              setIsCreatingFolder(true)
              setCreateError(null)
            }}
            disabled={!deviceId}
            title="New folder"
          >
            <FolderPlus size={15} />
          </Button>
          <div className="flex-1 min-w-0">
            <Breadcrumb path={currentPath === '~' ? '~' : currentPath} onNavigate={navigate} />
          </div>
        </div>

        {/* ── Body: sidebar + main ── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Sidebar */}
          <div className="w-52 shrink-0 border-r border-border bg-muted/20 overflow-hidden">
            <ScrollArea className="h-full">
              {deviceId ? (
                <>
                  <FavoritesSection activePath={currentPath} onNavigate={navigate} />
                  <FolderTree
                    key={`${deviceId}:${browseVersion}`}
                    deviceId={deviceId}
                    rootPath="~"
                    activePath={currentPath}
                    onNavigate={navigate}
                  />
                </>
              ) : (
                <div className="p-3 text-xs text-muted-foreground">No device selected</div>
              )}
            </ScrollArea>
          </div>

          {/* Main listing */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <ScrollArea className="flex-1 h-0">
              {deviceId ? (
                <FolderList
                  key={`${deviceId}:${currentPath}:${browseVersion}`}
                  deviceId={deviceId}
                  path={currentPath}
                  onNavigate={navigate}
                />
              ) : (
                <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                  Select a device to browse
                </div>
              )}
            </ScrollArea>

            {isCreatingFolder ? (
              <form
                className="flex items-center gap-2 px-3 py-2 border-t border-border shrink-0"
                onSubmit={handleCreateFolder}
              >
                <Input
                  autoFocus
                  className="h-8"
                  value={newFolderName}
                  onChange={(event) => {
                    setNewFolderName(event.target.value)
                    setCreateError(null)
                  }}
                  placeholder="Folder name"
                />
                <Button type="submit" size="sm" disabled={createLoading}>
                  {createLoading ? <Loader2 size={14} className="animate-spin" /> : 'Create'}
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-8" onClick={resetCreateFolder}>
                  <X size={15} />
                </Button>
                {createError && <span className="text-xs text-destructive truncate">{createError}</span>}
              </form>
            ) : (
              <p className="px-4 py-1.5 text-xs text-muted-foreground border-t border-border shrink-0">
                Double-click a folder to open it
              </p>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center gap-3 px-4 py-3 border-t border-border bg-muted/20 shrink-0">
          <code className="flex-1 text-xs font-mono text-muted-foreground truncate">
            {currentPath}
          </code>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSelect} disabled={!deviceId}>
            Select Folder
          </Button>
        </div>

      </div>
      </DialogContent>
    </Dialog>
  )
}

function isValidFolderName(name: string): boolean {
  return !!name && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\') && !name.includes('\0')
}
