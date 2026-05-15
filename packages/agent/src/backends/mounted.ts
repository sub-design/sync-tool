import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { localBackend } from './local'
import { joinRemote, type StorageBackend, type FileEntry, type FileMeta, type WriteOptions } from '../sync'

type MountedKind = 'smb' | 'nfs'

interface MountedConfig {
  kind: MountedKind
  mountSpec: string
  rootPath: string
  mountPoint: string
  args: string[]
}

export class MountedNetworkBackend implements StorageBackend {
  private mounted = false

  constructor(private readonly config: MountedConfig) {}

  async close(): Promise<void> {
    if (!this.mounted) return

    try {
      await runCommand('umount', [this.config.mountPoint])
    } catch {
      await runCommand('diskutil', ['umount', 'force', this.config.mountPoint])
    } finally {
      this.mounted = false
    }
  }

  async walk(rootPath: string): Promise<Map<string, FileEntry>> {
    await this.ensureMounted()

    const localRoot = this.toLocalPath(rootPath)
    const localEntries = await localBackend.walk(localRoot)
    const entries = new Map<string, FileEntry>()

    for (const [rel, entry] of localEntries) {
      entries.set(rel, {
        ...entry,
        absolutePath: joinRemote(rootPath, rel),
      })
    }

    return entries
  }

  async mkdirp(dirPath: string): Promise<void> {
    await this.ensureMounted()
    await localBackend.mkdirp(this.toLocalPath(dirPath))
  }

  async read(filePath: string, options?: { start?: number }): Promise<NodeJS.ReadableStream> {
    await this.ensureMounted()
    return localBackend.read(this.toLocalPath(filePath), options)
  }

  async partialSize(filePath: string, meta: FileMeta): Promise<number> {
    await this.ensureMounted()
    return localBackend.partialSize?.(this.toLocalPath(filePath), meta) ?? 0
  }

  async write(filePath: string, stream: NodeJS.ReadableStream, meta: FileMeta, options?: WriteOptions): Promise<void> {
    await this.ensureMounted()
    await localBackend.write(this.toLocalPath(filePath), stream, meta, options)
  }

  async delete(filePath: string): Promise<void> {
    await this.ensureMounted()
    await localBackend.delete?.(this.toLocalPath(filePath))
  }

  async move(fromPath: string, toPath: string, meta: FileMeta): Promise<void> {
    await this.ensureMounted()
    await localBackend.move?.(this.toLocalPath(fromPath), this.toLocalPath(toPath), meta)
  }

  localPath(filePath: string): string {
    return this.toLocalPath(filePath)
  }

  private async ensureMounted(): Promise<void> {
    if (this.mounted) return

    await fs.promises.mkdir(this.config.mountPoint, { recursive: true })
    if (await isMounted(this.config.mountPoint)) {
      this.mounted = true
      return
    }

    await runCommand(this.config.args[0], this.config.args.slice(1))
    this.mounted = true
    console.log(`[${this.config.kind}] Mounted ${this.config.mountSpec} at ${this.config.mountPoint}`)
  }

  private toLocalPath(remotePath: string): string {
    const remoteRoot = normalizePosixPath(this.config.rootPath)
    const normalizedRemote = normalizePosixPath(remotePath)
    const relative = path.posix.relative(remoteRoot, normalizedRemote)

    if (relative.startsWith('..')) {
      throw new Error(`${remotePath} is outside mounted root ${remoteRoot}`)
    }

    return path.join(this.config.mountPoint, relative)
  }
}

export function createSmbBackend(urlStr: string): { backend: MountedNetworkBackend; rootPath: string } {
  const url = new URL(urlStr)
  const pathParts = decodeURIComponent(url.pathname).split('/').filter(Boolean)
  const share = pathParts.shift()

  if (!share) {
    throw new Error('SMB URL must include a share name, e.g. smb://host/share/path')
  }

  const username = url.username ? decodeURIComponent(url.username) : ''
  const password = url.password ? decodeURIComponent(url.password) : ''
  const domain = url.searchParams.get('domain')
  const auth = username ? `${domain ? `${domain};` : ''}${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ''}@` : ''
  const mountSpec = `//${auth}${url.hostname}/${encodeURIComponent(share)}`
  const rootPath = normalizePosixPath(`/${pathParts.join('/')}`)
  const mountPoint = createMountPoint('smb', `${url.hostname}-${share}`)

  return {
    backend: new MountedNetworkBackend({
      kind: 'smb',
      mountSpec,
      rootPath,
      mountPoint,
      args: ['mount_smbfs', mountSpec, mountPoint],
    }),
    rootPath,
  }
}

export function createNfsBackend(urlStr: string): { backend: MountedNetworkBackend; rootPath: string } {
  const url = new URL(urlStr)
  const fullPath = normalizePosixPath(decodeURIComponent(url.pathname || '/'))
  const exportPath = normalizePosixPath(url.searchParams.get('export') ?? firstPathSegment(fullPath))
  const rootPath = normalizePosixPath(path.posix.relative(exportPath, fullPath))
  const mountSpec = `${url.hostname}:${exportPath}`
  const mountPoint = createMountPoint('nfs', `${url.hostname}-${exportPath}`)
  const options = url.searchParams.get('options')
  const args = options
    ? ['mount_nfs', '-o', options, mountSpec, mountPoint]
    : ['mount_nfs', '-o', 'resvport,soft,timeo=30,retrans=3', mountSpec, mountPoint]

  return {
    backend: new MountedNetworkBackend({
      kind: 'nfs',
      mountSpec,
      rootPath,
      mountPoint,
      args,
    }),
    rootPath,
  }
}

function normalizePosixPath(filePath: string): string {
  const normalized = path.posix.normalize(filePath.startsWith('/') ? filePath : `/${filePath}`)
  return normalized === '.' ? '/' : normalized
}

function firstPathSegment(filePath: string): string {
  const [segment] = filePath.split('/').filter(Boolean)
  if (!segment) throw new Error('NFS URL must include an export path, e.g. nfs://host/export/path')
  return `/${segment}`
}

function createMountPoint(kind: MountedKind, key: string): string {
  const hash = crypto.createHash('sha1').update(`${kind}:${key}`).digest('hex').slice(0, 12)
  return path.join(os.tmpdir(), 'sync-tool-mounts', `${kind}-${hash}`)
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''

    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`))
      }
    })
  })
}

async function isMounted(mountPoint: string): Promise<boolean> {
  try {
    const output = await collectCommand('mount', [])
    return output.split('\n').some((line) => line.includes(` on ${mountPoint} `))
  } catch {
    return false
  }
}

async function collectCommand(command: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`))
      }
    })
  })
}
