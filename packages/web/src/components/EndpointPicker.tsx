import { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, HardDrive, Lock, Network, Server, Terminal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BACKEND_DEFAULTS, type BackendType, type EndpointConfig } from '../types'
import { buildBackendUrl, maskBackendPassword, parseBackendUrl } from '@/lib/backend'

interface EndpointPickerProps {
  label:    string
  value:    string
  onChange: (url: string) => void
}

const BACKEND_OPTIONS = [
  { type: 'local' as const, label: 'Local', Icon: HardDrive },
  { type: 'sftp' as const, label: 'SFTP', Icon: Terminal },
  { type: 'ftp' as const, label: 'FTP', Icon: Terminal },
  { type: 'ftps' as const, label: 'FTPS', Icon: Lock },
  { type: 'smb' as const, label: 'SMB', Icon: Network },
  { type: 'nfs' as const, label: 'NFS', Icon: Server },
]

function withTypeDefaults(config: EndpointConfig, type: BackendType): EndpointConfig {
  return {
    ...config,
    type,
    port: BACKEND_DEFAULTS[type].port ?? '',
    username: type === 'nfs' ? '' : config.username,
    password: type === 'nfs' ? '' : config.password,
  }
}

export default function EndpointPicker({ label, value, onChange }: EndpointPickerProps) {
  const [config, setConfig] = useState(() => parseBackendUrl(value))
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    const next = parseBackendUrl(value)
    if (buildBackendUrl(config) !== value) setConfig(next)
    // Only respond to external value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const preview = useMemo(() => maskBackendPassword(buildBackendUrl(config)), [config])

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

  const isRemote = config.type !== 'local'
  const usesPort = config.type === 'sftp' || config.type === 'ftp' || config.type === 'ftps'
  const usesCredentials = isRemote && config.type !== 'nfs'

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <Label>{label}</Label>

      <div className="grid grid-cols-2 rounded-md border border-border overflow-hidden sm:grid-cols-6">
        {BACKEND_OPTIONS.map(({ type, label: optionLabel, Icon }) => (
          <Button
            key={type}
            type="button"
            variant="ghost"
            className={[
              'rounded-none w-full gap-1.5 border-border text-xs sm:text-sm',
              'not-last:border-r sm:not-last:border-r',
              config.type === type ? 'bg-secondary font-medium' : '',
            ].join(' ')}
            onClick={() => setType(type)}
          >
            <Icon size={16} />
            {optionLabel}
          </Button>
        ))}
      </div>

      {config.type === 'local' ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${label}-local-path`}>Local path</Label>
          <div className="relative">
            <HardDrive className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={`${label}-local-path`}
              className="pl-9 font-mono text-sm"
              placeholder="/Users/alex/Documents"
              value={config.localPath}
              onChange={event => updateConfig({ localPath: event.target.value })}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${label}-host`}>Host</Label>
              <Input
                id={`${label}-host`}
                placeholder="nas.local"
                value={config.host}
                onChange={event => updateConfig({ host: event.target.value })}
              />
            </div>

            {usesPort && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${label}-port`}>Port</Label>
                <Input
                  id={`${label}-port`}
                  className="w-20"
                  value={config.port}
                  onChange={event => updateConfig({ port: event.target.value })}
                />
              </div>
            )}
          </div>

          {usesCredentials && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${label}-username`}>Username</Label>
                <Input
                  id={`${label}-username`}
                  value={config.username}
                  onChange={event => updateConfig({ username: event.target.value })}
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
                    onChange={event => updateConfig({ password: event.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 size-8 -translate-y-1/2"
                    onClick={() => setShowPassword(current => !current)}
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
                onChange={event => updateConfig({ share: event.target.value })}
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
              onChange={event => updateConfig({ remotePath: event.target.value })}
            />
          </div>
        </div>
      )}

      <p className="font-mono text-xs text-muted-foreground mt-2 break-all">
        {preview}
      </p>
    </div>
  )
}
