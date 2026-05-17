import os from 'os'
import path from 'path'

export interface PathVariableContext {
  deviceId?: string
}

const VARIABLE_PATTERN = /\{([A-Za-z][A-Za-z0-9_.:-]*)\}/g

export function resolvePathVariables(input: string, context: PathVariableContext = {}): string {
  return input.replace(VARIABLE_PATTERN, (_match, rawName: string) => {
    const value = variableValue(rawName, context)
    if (value == null) throw new Error(`Unknown path variable: {${rawName}}`)
    return value
  })
}

export function resolveUserPath(inputPath: string, context: PathVariableContext = {}): string {
  const expanded = resolvePathVariables(inputPath, context)
  if (expanded === '~' || expanded === '') return os.homedir()
  if (expanded.startsWith('~/')) return path.resolve(os.homedir(), expanded.slice(2))
  if (expanded.startsWith('file://')) return path.resolve(decodeURIComponent(new URL(expanded).pathname))
  return path.resolve(expanded)
}

function variableValue(rawName: string, context: PathVariableContext): string | undefined {
  if (rawName.startsWith('Env:')) return process.env[rawName.slice(4)]
  if (rawName.startsWith('env:')) return process.env[rawName.slice(4)]
  if (rawName.startsWith('env.')) return process.env[rawName.slice(4)]

  switch (rawName.toLowerCase()) {
    case 'userhome':
    case 'home':
      return os.homedir()
    case 'systemdrive':
      return systemDrive()
    case 'temp':
    case 'tmp':
      return os.tmpdir()
    case 'desktop':
      return path.join(os.homedir(), 'Desktop')
    case 'documents':
      return path.join(os.homedir(), 'Documents')
    case 'downloads':
      return path.join(os.homedir(), 'Downloads')
    case 'pictures':
      return path.join(os.homedir(), 'Pictures')
    case 'music':
      return path.join(os.homedir(), 'Music')
    case 'movies':
    case 'videos':
      return path.join(os.homedir(), process.platform === 'win32' ? 'Videos' : 'Movies')
    case 'hostname':
    case 'computername':
      return os.hostname()
    case 'platform':
    case 'os':
      return process.platform
    case 'deviceid':
      return context.deviceId ?? process.env.DEVICE_ID
    case 'location':
      return process.env.DEVICE_LOCATION ?? process.env.LOCATION
    default:
      return process.env[rawName]
  }
}

function systemDrive(): string {
  if (process.env.SystemDrive) return process.env.SystemDrive
  if (process.env.SYSTEMDRIVE) return process.env.SYSTEMDRIVE

  const parsed = path.parse(os.homedir())
  return parsed.root.replace(/[\\/]$/, '') || parsed.root
}
