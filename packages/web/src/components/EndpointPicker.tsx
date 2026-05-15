import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, Folder, HardDrive, Lock, Network, Server, Terminal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { BACKEND_DEFAULTS, type BackendType, type EndpointConfig } from '../types'
import { buildBackendUrl, parseBackendUrl } from '@/lib/backend'

interface EndpointPickerProps {
  label: string
  value: string
  onChange: (url: string) => void
}

const BACKEND_OPTIONS = [
  { type: 'local' as const, label: 'Local',  Icon: HardDrive },
  { type: 'sftp'  as const, label: 'SFTP',   Icon: Terminal },
  { type: 'ftp'   as const, label: 'FTP',    Icon: Terminal },
  { type: 'ftps'  as const, label: 'FTPS',   Icon: Lock },
  { type: 'smb'   as const, label: 'SMB',    Icon: Network },
  { type: 'nfs'   as const, label: 'NFS',    Icon: Server },
]

function withTypeDefaults(config: EndpointConfig, type: BackendType): EndpointConfig {
  return {
    ...config,
    type,
    port:     BACKEND_DEFAULTS[type].port ?? '',
    username: type === 'nfs' ? '' : config.username,
    password: type === 'nfs' ? '' : config.password,
  }
}

function parseFolderPath(p: string): { name: string; breadcrumbs: string } {
  const sep = p.includes('\\') ? '\\' : '/'
  const parts = p.split(sep).filter(Boolean)
  const name = parts[parts.length - 1] ?? p
  const crumbs = parts.slice(0, -1).join(` > `)
  return { name, breadcrumbs: crumbs || sep }
}

export default function EndpointPicker({ label, value, onChange }: EndpointPickerProps) {
  const [config, setConfig] = useState(() => parseBackendUrl(value))
  const [showPassword, setShowPassword] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const next = parseBackendUrl(value)
    if (buildBackendUrl(config) !== value) setConfig(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const updateConfig = (patch: Partial<EndpointConfig>) => {
    setConfig(current => {
      const next = { ...current, ...patch }
      onChange(buildBackendUrl(next))
      return next
    })
  }

  const setType = (type: BackendType) => {
    setConfig(current => {
      const next = withTypeDefaults(current, type)
      onChange(buildBackendUrl(next))
      return next
    })
  }

  const handleBrowse = () => fileInputRef.current?.click()

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const filePath = (file as File & { path?: string }).path
    if (filePath) {
      // Electron: strip the filename to get the folder path
      const sep = filePath.includes('\\') ? '\\' : '/'
      const parts = filePath.split(sep).filter(Boolean)
      parts.pop() // remove file name, keep directory
      const dir = (filePath.startsWith(sep) ? sep : '') + parts.join(sep)
      updateConfig({ localPath: dir || filePath })
    }
    e.target.value = ''
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    // Electron: dragged folder exposes real path via files[0].path
    const file = e.dataTransfer.files[0] as (File & { path?: string }) | undefined
    if (file?.path) {
      updateConfig({ localPath: file.path })
      return
    }

    // Browser fallback: use directory name from entry
    const entry = e.dataTransfer.items[0]?.webkitGetAsEntry()
    if (entry?.isDirectory) {
      updateConfig({ localPath: entry.name })
    }
  }

  const isRemote  = config.type !== 'local'
  const usesPort  = config.type === 'sftp' || config.type === 'ftp' || config.type === 'ftps'
  const usesCreds = isRemote && config.type !== 'nfs'
  const hasLocal  = !isRemote && !!config.localPath
  const currentOpt = BACKEND_OPTIONS.find(o => o.type === config.type)!

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Type selector */}
      <Select value={config.type} onValueChange={val => setType(val as BackendType)}>
        <SelectTrigger className="w-full">
          <SelectValue>
            <span className="flex items-center gap-2">
              <currentOpt.Icon size={14} />
              {currentOpt.label}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {BACKEND_OPTIONS.map(({ type, label: optLabel, Icon }) => (
            <SelectItem key={type} value={type}>
              <span className="flex items-center gap-2">
                <Icon size={14} />
                {optLabel}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Local: folder picker */}
      {!isRemote && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            // @ts-expect-error webkitdirectory is non-standard
            webkitdirectory=""
            className="hidden"
            onChange={handleFileInputChange}
          />

          {hasLocal ? (
            /* Selected state */
            <SelectedFolderPanel
              path={config.localPath}
              onChangeRequest={handleBrowse}
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              isDragOver={isDragOver}
            />
          ) : (
            /* Empty placeholder */
            <div
              className={[
                'flex-1 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 min-h-[280px] transition-colors',
                isDragOver ? 'border-primary bg-primary/5' : 'border-border',
              ].join(' ')}
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="relative">
                <Folder size={64} className="text-muted-foreground/20" strokeWidth={1} />
                <span className="absolute inset-0 flex items-end justify-center pb-2.5 text-muted-foreground/35 font-bold text-2xl">?</span>
              </div>
              <p className="font-semibold text-sm text-center text-foreground">{label}</p>
              <Button type="button" onClick={handleBrowse}>
                Browse Folders
              </Button>
              <div className="flex flex-col items-center gap-0.5 text-xs text-muted-foreground">
                <span>or</span>
                <span>Drag and drop a folder here</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Remote: connection fields */}
      {isRemote && (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${label}-host`}>Host</Label>
              <Input
                id={`${label}-host`}
                placeholder="nas.local"
                value={config.host}
                onChange={e => updateConfig({ host: e.target.value })}
              />
            </div>
            {usesPort && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${label}-port`}>Port</Label>
                <Input
                  id={`${label}-port`}
                  className="w-20"
                  value={config.port}
                  onChange={e => updateConfig({ port: e.target.value })}
                />
              </div>
            )}
          </div>

          {usesCreds && (
            <div className="grid gap-3 grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${label}-username`}>Username</Label>
                <Input
                  id={`${label}-username`}
                  value={config.username}
                  onChange={e => updateConfig({ username: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${label}-password`}>Password</Label>
                <div className="relative">
                  <Input
                    id={`${label}-password`}
                    type={showPassword ? 'text' : 'password'}
                    className="pr-10"
                    value={config.password}
                    onChange={e => updateConfig({ password: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 size-8 -translate-y-1/2"
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {config.type === 'smb' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${label}-share`}>Share name</Label>
              <Input
                id={`${label}-share`}
                placeholder="backup"
                value={config.share}
                onChange={e => updateConfig({ share: e.target.value })}
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${label}-remote-path`}>
              {config.type === 'nfs' ? 'Export path' : 'Remote path'}
            </Label>
            <Input
              id={`${label}-remote-path`}
              className="font-mono text-sm"
              placeholder={config.type === 'nfs' ? '/export/data' : '/home/alex/backup'}
              value={config.remotePath}
              onChange={e => updateConfig({ remotePath: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  )
}

interface SelectedFolderPanelProps {
  path: string
  onChangeRequest: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragEnter: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  isDragOver: boolean
}

function SelectedFolderPanel({
  path,
  onChangeRequest,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  isDragOver,
}: SelectedFolderPanelProps) {
  const { name, breadcrumbs } = parseFolderPath(path)

  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        'flex-1 flex flex-col items-center justify-center gap-3 rounded-xl border-2 p-8 min-h-[280px] cursor-pointer transition-colors group',
        isDragOver
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-border/80 hover:bg-accent/40',
      ].join(' ')}
      onClick={onChangeRequest}
      onKeyDown={e => e.key === 'Enter' && onChangeRequest()}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Folder size={64} className="text-muted-foreground/50" strokeWidth={1} fill="currentColor" />

      <div className="flex flex-col items-center gap-1 text-center">
        <p className="font-semibold text-base text-foreground">{name}</p>
        {breadcrumbs && (
          <p className="text-xs text-muted-foreground max-w-[180px] leading-relaxed">
            {breadcrumbs}
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
        Click to change folder
      </p>
    </div>
  )
}
