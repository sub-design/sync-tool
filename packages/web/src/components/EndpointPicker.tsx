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

export default function EndpointPicker({ label, value, onChange }: EndpointPickerProps) {
  const [config, setConfig] = useState(() => parseBackendUrl(value))
  const [showPassword, setShowPassword] = useState(false)
  const [editingPath, setEditingPath] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const pathInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const next = parseBackendUrl(value)
    if (buildBackendUrl(config) !== value) setConfig(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    if (editingPath) pathInputRef.current?.focus()
  }, [editingPath])

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

  const handleBrowse = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click()
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // In Electron, file.path gives the real filesystem path
    const filePath = (file as File & { path?: string }).path
    if (filePath) {
      const dir = filePath.substring(0, filePath.lastIndexOf('/')) || filePath
      updateConfig({ localPath: dir })
    } else {
      setEditingPath(true)
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
    // Only clear if leaving the drop zone entirely (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    // Electron: files[0].path gives the real filesystem path for dragged folders
    const file = e.dataTransfer.files[0] as (File & { path?: string }) | undefined
    if (file?.path) {
      // In Electron, a dragged folder's path is the folder itself
      updateConfig({ localPath: file.path })
      return
    }

    // Browser fallback: webkitGetAsEntry gives at least the folder name
    const entry = e.dataTransfer.items[0]?.webkitGetAsEntry()
    if (entry?.isDirectory) {
      updateConfig({ localPath: entry.name })
    }
    setEditingPath(true)
  }

  const isRemote   = config.type !== 'local'
  const usesPort   = config.type === 'sftp' || config.type === 'ftp' || config.type === 'ftps'
  const usesCreds  = isRemote && config.type !== 'nfs'
  const hasLocal   = !isRemote && !!config.localPath
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

          {hasLocal && !editingPath ? (
            /* Compact selected state */
            <div
              className="flex items-center gap-2 rounded-md border border-border p-3 cursor-pointer hover:bg-accent transition-colors"
              onClick={() => setEditingPath(true)}
            >
              <Folder size={16} className="text-muted-foreground shrink-0" />
              <span className="font-mono text-sm truncate flex-1 text-left">{config.localPath}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={e => { e.stopPropagation(); setEditingPath(true) }}
              >
                Change
              </Button>
            </div>
          ) : editingPath ? (
            /* Path input */
            <div className="flex gap-2">
              <Input
                ref={pathInputRef}
                className="font-mono text-sm"
                placeholder="/Users/alex/Documents"
                value={config.localPath}
                onChange={e => updateConfig({ localPath: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') setEditingPath(false) }}
              />
              <Button type="button" variant="outline" onClick={() => setEditingPath(false)}>
                Done
              </Button>
            </div>
          ) : (
            /* Empty placeholder */
            <div
              className={[
                'flex-1 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 min-h-[280px] transition-colors',
                isDragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-border',
              ].join(' ')}
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="relative">
                <Folder size={56} className="text-muted-foreground/25" strokeWidth={1.2} />
                <span className="absolute inset-0 flex items-end justify-center pb-2 text-muted-foreground/40 font-bold text-xl">?</span>
              </div>
              <p className="font-semibold text-sm text-center">{label}</p>
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
