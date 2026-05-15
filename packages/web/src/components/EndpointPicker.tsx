import { useEffect, useState } from 'react'
import { Eye, EyeOff, Folder, HardDrive, Lock, Network, Server, Terminal, Monitor } from 'lucide-react'

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
import { FolderPickerDialog } from '@/components/FolderPickerDialog'
import { useWsStore } from '@/lib/ws'
import { BACKEND_DEFAULTS, type BackendType, type EndpointConfig } from '../types'
import { buildBackendUrl, parseBackendUrl } from '@/lib/backend'

interface EndpointPickerProps {
  label:          string
  value:          string
  onChange:       (url: string) => void
  deviceId?:      string
  onDeviceChange?: (deviceId: string | undefined) => void
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

export default function EndpointPicker({ label, value, onChange, deviceId, onDeviceChange }: EndpointPickerProps) {
  const agentsOnline = useWsStore(s => s.agentsOnline)
  const [config, setConfig] = useState(() => parseBackendUrl(value))
  const [showPassword, setShowPassword] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

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

    // Electron exposes the real filesystem path via files[0].path
    const file = e.dataTransfer.files[0] as (File & { path?: string }) | undefined
    if (file?.path) {
      updateConfig({ localPath: file.path })
    }
    // In a regular browser the full path is not accessible — ignore the drop
  }

  const isRemote   = config.type !== 'local'
  const usesPort   = config.type === 'sftp' || config.type === 'ftp' || config.type === 'ftps'
  const usesCreds  = isRemote && config.type !== 'nfs'
  const hasLocal   = !isRemote && !!config.localPath
  const currentOpt = BACKEND_OPTIONS.find(o => o.type === config.type)!
  const agentsList = [...agentsOnline.entries()]
  const selectedHostname = deviceId ? (agentsOnline.get(deviceId) ?? deviceId) : null

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
          {hasLocal ? (
            /* Selected state */
            <SelectedFolderPanel
              path={config.localPath}
              deviceName={selectedHostname}
              onPathChange={path => updateConfig({ localPath: path })}
              onBrowse={() => setPickerOpen(true)}
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

              {agentsList.length > 0 ? (
                <Button type="button" onClick={() => setPickerOpen(true)}>
                  Browse Folders
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground text-center">
                  Connect the{' '}
                  <a href="/download" className="underline underline-offset-2 hover:text-foreground">
                    desktop app
                  </a>{' '}
                  to browse folders
                </p>
              )}

            </div>
          )}

          <FolderPickerDialog
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            initialDeviceId={deviceId}
            initialPath={config.localPath || undefined}
            onSelect={(selectedDeviceId, selectedPath) => {
              updateConfig({ localPath: selectedPath })
              onDeviceChange?.(selectedDeviceId)
            }}
          />
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
  path:         string
  deviceName:   string | null
  onPathChange: (path: string) => void
  onBrowse:     () => void
  onDragOver:   (e: React.DragEvent) => void
  onDragEnter:  (e: React.DragEvent) => void
  onDragLeave:  (e: React.DragEvent) => void
  onDrop:       (e: React.DragEvent) => void
  isDragOver:   boolean
}

function SelectedFolderPanel({
  path,
  deviceName,
  onPathChange,
  onBrowse,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  isDragOver,
}: SelectedFolderPanelProps) {
  const { name, breadcrumbs } = parseFolderPath(path)
  const isAbsolute = path.startsWith('/') || /^[A-Za-z]:\\/.test(path)

  return (
    <div className="flex flex-col gap-2 flex-1">
      {/* Visual drop zone */}
      <div
        className={[
          'flex flex-col items-center justify-center gap-3 rounded-xl border-2 p-6 min-h-[200px] transition-colors',
          isDragOver
            ? 'border-primary bg-primary/5'
            : 'border-border bg-accent/20',
        ].join(' ')}
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <Folder size={52} className="text-muted-foreground/40" strokeWidth={1} fill="currentColor" />
        <div className="flex flex-col items-center gap-0.5 text-center">
          <p className="font-semibold text-sm text-foreground">{name}</p>
          {breadcrumbs && (
            <p className="text-xs text-muted-foreground">{breadcrumbs}</p>
          )}
          {deviceName && (
            <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
              <Monitor size={11} />
              <span>{deviceName}</span>
            </div>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onBrowse}>
          Browse…
        </Button>
      </div>

      {/* Editable path — always visible so user can verify/correct */}
      <div className="flex flex-col gap-1">
        <div className="flex gap-2 items-center">
          <Input
            className="font-mono text-xs"
            placeholder="/Users/alex/Documents"
            value={path}
            onChange={e => onPathChange(e.target.value)}
          />
        </div>
        {!isAbsolute && (
          <p className="text-xs text-destructive">
            Enter the full absolute path (e.g. /Users/alex/Documents)
          </p>
        )}
      </div>
    </div>
  )
}
