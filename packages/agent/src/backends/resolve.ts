import type { StorageBackend } from '../sync'
import { localBackend } from './local'
import { createSftpBackend } from './sftp'
import { createFtpBackend } from './ftp'
import { createSmbBackend, createNfsBackend } from './mounted'
import { createS3Backend } from './s3'
import { resolvePathVariables, resolveUserPath } from '../pathVariables'

export interface ResolvedBackend {
  backend:  StorageBackend
  rootPath: string
}

export function resolveBackend(location: string): ResolvedBackend {
  const resolvedLocation = resolvePathVariables(location)
  const scheme = getScheme(resolvedLocation)

  switch (scheme) {
    case 'sftp':
      return createSftpBackend(resolvedLocation)
    case 'ftp':
    case 'ftps':
      return createFtpBackend(resolvedLocation)
    case 'smb':
      return createSmbBackend(resolvedLocation)
    case 'cifs':
      return createSmbBackend(resolvedLocation)
    case 'nfs':
      return createNfsBackend(resolvedLocation)
    case 's3':
      return createS3Backend(resolvedLocation)
    case undefined:
    case 'file':
      return {
        backend:  localBackend,
        rootPath: resolveLocalPath(resolvedLocation),
      }
    default:
      throw new Error(`Unsupported backend scheme: ${scheme}`)
  }
}

function getScheme(location: string): string | undefined {
  const match = /^([a-z][a-z0-9+.-]*):\/\//i.exec(location)
  return match?.[1].toLowerCase()
}

function resolveLocalPath(location: string): string {
  return resolveUserPath(location)
}
