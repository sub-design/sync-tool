import SftpClient from 'ssh2-sftp-client'
import type { StorageBackend, FileEntry, FileMeta, WriteOptions } from '../sync'

export class SftpBackend implements StorageBackend {
  private client: SftpClient
  private connected = false
  private host: string
  private port: number
  private username: string
  private password?: string

  constructor(urlStr: string) {
    const url = new URL(urlStr)

    this.host = url.hostname
    this.port = parseInt(url.port, 10) || 22
    this.username = decodeURIComponent(url.username)
    this.password = url.password ? decodeURIComponent(url.password) : undefined
    this.client = new SftpClient('sync-tool')
  }

  async close(): Promise<void> {
    if (!this.connected) return

    await this.client.end()
    this.connected = false
  }

  async walk(rootPath: string): Promise<Map<string, FileEntry>> {
    await this.ensureConnected()
    const entries = new Map<string, FileEntry>()

    const recurse = async (dir: string) => {
      let items: SftpClient.FileInfo[]
      try {
        items = await this.client.list(dir)
      } catch (err: any) {
        console.warn(`[sftp] Cannot list ${dir}: ${err.message}`)
        return
      }

      for (const item of items) {
        if (item.name === '.' || item.name === '..') continue

        const abs = joinSftpPath(dir, item.name)
        const rel = abs.slice(normalizeSftpPath(rootPath).length).replace(/^\//, '')

        if (item.type === 'd') {
          entries.set(rel, {
            relativePath: rel,
            absolutePath: abs,
            size:         0,
            mtimeMs:      0,
            isDirectory:  true,
          })
          await recurse(abs)
        } else if (item.type === '-') {
          entries.set(rel, {
            relativePath: rel,
            absolutePath: abs,
            size:         item.size,
            mtimeMs:      item.modifyTime,
            isDirectory:  false,
          })
        }
      }
    }

    await recurse(rootPath)
    return entries
  }

  async mkdirp(dirPath: string): Promise<void> {
    await this.ensureConnected()

    const exists = await this.client.exists(dirPath)
    if (!exists) await this.client.mkdir(dirPath, true)
  }

  async read(filePath: string, options?: { start?: number }): Promise<NodeJS.ReadableStream> {
    await this.ensureConnected()
    return (this.client as any).createReadStream(filePath, options?.start ? { start: options.start } : undefined)
  }

  async partialSize(filePath: string, meta: FileMeta): Promise<number> {
    await this.ensureConnected()
    const partialPath = sftpPartialPath(filePath)
    try {
      const stat = await (this.client as any).stat(partialPath)
      return stat.size > 0 && stat.size < meta.size ? stat.size : 0
    } catch {
      return 0
    }
  }

  async write(filePath: string, stream: NodeJS.ReadableStream, meta: FileMeta, options: WriteOptions = {}): Promise<void> {
    await this.ensureConnected()

    const parentDir = filePath.slice(0, filePath.lastIndexOf('/')) || '/'
    await this.mkdirp(parentDir)
    const targetPath = options.atomic ? sftpPartialPath(filePath) : filePath
    const writeStream = (this.client as any).createWriteStream(targetPath, {
      flags: options.resumeOffset && options.resumeOffset > 0 ? 'a' : 'w',
    } as any)
    await new Promise<void>((resolve, reject) => {
      stream.on('error', reject)
      writeStream.on('error', reject)
      writeStream.on('finish', resolve)
      stream.pipe(writeStream)
    })

    if (options.expectedSize && !meta.encrypted) {
      const stat = await (this.client as any).stat(targetPath)
      if (stat.size !== options.expectedSize) {
        throw new Error(`Partial write size mismatch: got ${stat.size}, expected ${options.expectedSize}`)
      }
    }

    await this.setMtime(targetPath, meta.mtimeMs)

    if (options.atomic) {
      await ((this.client as any).posixRename?.(targetPath, filePath) ?? (this.client as any).rename(targetPath, filePath))
    }
  }

  async move(fromPath: string, toPath: string, meta: FileMeta): Promise<void> {
    await this.ensureConnected()
    const parentDir = toPath.slice(0, toPath.lastIndexOf('/')) || '/'
    await this.mkdirp(parentDir)
    await ((this.client as any).posixRename?.(fromPath, toPath) ?? (this.client as any).rename(fromPath, toPath))
    await this.setMtime(toPath, meta.mtimeMs)
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return

    await this.client.connect({
      host:         this.host,
      port:         this.port,
      username:     this.username,
      password:     this.password,
      readyTimeout: 10_000,
    })
    this.connected = true
    console.log(`[sftp] Connected to ${this.username}@${this.host}:${this.port}`)
  }

  private async setMtime(filePath: string, mtimeMs: number): Promise<void> {
    try {
      const sftp = (this.client as any).sftp
      if (!sftp) return

      await new Promise<void>((resolve, reject) => {
        sftp.setstat(filePath, {
          atime: Math.floor(Date.now() / 1000),
          mtime: Math.floor(mtimeMs / 1000),
        }, (err: Error | undefined) => err ? reject(err) : resolve())
      })
    } catch {
      // Some SFTP servers reject setstat; a copied file is still valid without mtime preservation.
    }
  }
}

export function createSftpBackend(urlStr: string): { backend: SftpBackend; rootPath: string } {
  const url = new URL(urlStr)
  return {
    backend:  new SftpBackend(urlStr),
    rootPath: normalizeSftpPath(decodeURIComponent(url.pathname || '/')),
  }
}

function normalizeSftpPath(filePath: string): string {
  const normalized = filePath.replace(/\/+/g, '/')
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function joinSftpPath(base: string, name: string): string {
  return `${base.replace(/\/+$/, '')}/${name}`.replace(/\/+/g, '/')
}

function sftpPartialPath(filePath: string): string {
  const slash = filePath.lastIndexOf('/')
  const dir = slash >= 0 ? filePath.slice(0, slash) : ''
  const name = slash >= 0 ? filePath.slice(slash + 1) : filePath
  const dot = name.lastIndexOf('.')
  const partial = dot > 0
    ? `${name.slice(0, dot)}.sync-tool-part${name.slice(dot)}`
    : `${name}.sync-tool-part`
  return dir ? `${dir}/${partial}` : partial
}
