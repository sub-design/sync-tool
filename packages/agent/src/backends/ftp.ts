import { Client, type FileInfo } from 'basic-ftp'
import { PassThrough } from 'stream'
import type { StorageBackend, FileEntry, FileMeta, WriteOptions } from '../sync'

export class FtpBackend implements StorageBackend {
  private client = new Client(30_000)
  private connected = false
  private host: string
  private port: number
  private username: string
  private password: string
  private secure: boolean | 'implicit'

  constructor(urlStr: string) {
    const url = new URL(urlStr)

    this.host = url.hostname
    this.port = parseInt(url.port, 10) || (url.protocol === 'ftps:' ? 990 : 21)
    this.secure = url.protocol === 'ftps:' ? (this.port === 990 ? 'implicit' : true) : false
    this.username = url.username ? decodeURIComponent(url.username) : 'anonymous'
    this.password = url.password ? decodeURIComponent(url.password) : 'anonymous@'
  }

  close(): Promise<void> {
    this.client.close()
    this.connected = false
    return Promise.resolve()
  }

  async walk(rootPath: string): Promise<Map<string, FileEntry>> {
    await this.ensureConnected()
    const entries = new Map<string, FileEntry>()
    const normalizedRoot = normalizeFtpPath(rootPath)

    const recurse = async (dir: string) => {
      let items: FileInfo[]
      try {
        items = await this.client.list(dir)
      } catch (err: any) {
        console.warn(`[ftp] Cannot list ${dir}: ${err.message}`)
        return
      }

      for (const item of items) {
        if (item.name === '.' || item.name === '..') continue

        const abs = joinFtpPath(dir, item.name)
        const rel = abs.slice(normalizedRoot.length).replace(/^\//, '')

        if (item.isDirectory) {
          entries.set(rel, {
            relativePath: rel,
            absolutePath: abs,
            size:         0,
            mtimeMs:      0,
            isDirectory:  true,
          })
          await recurse(abs)
        } else if (item.isFile) {
          entries.set(rel, {
            relativePath: rel,
            absolutePath: abs,
            size:         item.size ?? 0,
            mtimeMs:      item.modifiedAt?.getTime() ?? 0,
            isDirectory:  false,
          })
        }
      }
    }

    await recurse(normalizedRoot)
    return entries
  }

  async mkdirp(dirPath: string): Promise<void> {
    await this.ensureConnected()
    await this.client.ensureDir(normalizeFtpPath(dirPath))
    await this.client.cd('/')
  }

  async read(filePath: string, options?: { start?: number }): Promise<NodeJS.ReadableStream> {
    await this.ensureConnected()
    const stream = new PassThrough()
    this.client.downloadTo(stream, normalizeFtpPath(filePath), options?.start ?? 0)
      .catch((err) => stream.destroy(err))
    return stream
  }

  async partialSize(filePath: string, meta: FileMeta): Promise<number> {
    await this.ensureConnected()
    const partialPath = ftpPartialPath(filePath)
    try {
      const size = await this.client.size(partialPath)
      return size > 0 && size < meta.size ? size : 0
    } catch {
      return 0
    }
  }

  async write(filePath: string, stream: NodeJS.ReadableStream, meta: FileMeta, options: WriteOptions = {}): Promise<void> {
    await this.ensureConnected()

    const normalizedPath = normalizeFtpPath(filePath)
    const parentDir = normalizedPath.slice(0, normalizedPath.lastIndexOf('/')) || '/'
    await this.client.ensureDir(parentDir)
    await this.client.cd('/')

    const targetPath = options.atomic ? ftpPartialPath(normalizedPath) : normalizedPath
    if (options.resumeOffset && options.resumeOffset > 0) {
      await this.client.appendFrom(stream as any, targetPath)
    } else {
      await this.client.uploadFrom(stream as any, targetPath)
    }

    if (options.expectedSize && !meta.encrypted) {
      const size = await this.client.size(targetPath)
      if (size !== options.expectedSize) {
        throw new Error(`Partial write size mismatch: got ${size}, expected ${options.expectedSize}`)
      }
    }

    // TODO Phase 5 - preserve FTP mtime with MFMT when the server supports it.
    if (options.atomic) {
      await this.client.rename(targetPath, normalizedPath)
    }
  }

  async move(fromPath: string, toPath: string, _meta: FileMeta): Promise<void> {
    await this.ensureConnected()
    const normalizedTo = normalizeFtpPath(toPath)
    const parentDir = normalizedTo.slice(0, normalizedTo.lastIndexOf('/')) || '/'
    await this.client.ensureDir(parentDir)
    await this.client.cd('/')
    await this.client.rename(normalizeFtpPath(fromPath), normalizedTo)
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected && !this.client.closed) return

    if (this.client.closed) {
      this.client = new Client(30_000)
    }

    await this.client.access({
      host:          this.host,
      port:          this.port,
      user:          this.username,
      password:      this.password,
      secure:        this.secure,
      secureOptions: { rejectUnauthorized: false },
    })
    this.connected = true
    console.log(`[ftp] Connected to ${this.username}@${this.host}:${this.port}`)
  }
}

export function createFtpBackend(urlStr: string): { backend: FtpBackend; rootPath: string } {
  const url = new URL(urlStr)
  return {
    backend:  new FtpBackend(urlStr),
    rootPath: normalizeFtpPath(decodeURIComponent(url.pathname || '/')),
  }
}

function normalizeFtpPath(filePath: string): string {
  const normalized = filePath.replace(/\/+/g, '/')
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function joinFtpPath(base: string, name: string): string {
  return `${base.replace(/\/+$/, '')}/${name}`.replace(/\/+/g, '/')
}

function ftpPartialPath(filePath: string): string {
  const slash = filePath.lastIndexOf('/')
  const dir = slash >= 0 ? filePath.slice(0, slash) : ''
  const name = slash >= 0 ? filePath.slice(slash + 1) : filePath
  const dot = name.lastIndexOf('.')
  const partial = dot > 0
    ? `${name.slice(0, dot)}.sync-tool-part${name.slice(dot)}`
    : `${name}.sync-tool-part`
  return dir ? `${dir}/${partial}` : partial
}
