import path from 'path'
import type { StorageBackend } from '../sync'
import { localBackend } from './local'
import { createSftpBackend } from './sftp'
import { createFtpBackend } from './ftp'
import { createSmbBackend, createNfsBackend } from './mounted'
import { createS3Backend } from './s3'

export interface ResolvedBackend {
  backend:  StorageBackend
  rootPath: string
}

export function resolveBackend(location: string): ResolvedBackend {
  const scheme = getScheme(location)

  switch (scheme) {
    case 'sftp':
      return createSftpBackend(location)
    case 'ftp':
    case 'ftps':
      return createFtpBackend(location)
    case 'smb':
      return createSmbBackend(location)
    case 'cifs':
      return createSmbBackend(location)
    case 'nfs':
      return createNfsBackend(location)
    case 's3':
      return createS3Backend(location)
    case undefined:
    case 'file':
      return {
        backend:  localBackend,
        rootPath: resolveLocalPath(location),
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
  if (location.startsWith('file://')) {
    return decodeURIComponent(new URL(location).pathname)
  }

  return path.resolve(location)
}
