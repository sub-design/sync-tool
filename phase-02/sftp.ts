/**
 * SFTP Storage Backend
 *
 * URL format:  sftp://user:password@host:22/path/to/dir
 *              sftp://user@host/path                     ← key auth (TODO Phase 5)
 *
 * Install:     pnpm add ssh2-sftp-client
 *              pnpm add -D @types/ssh2
 */

import SftpClient from 'ssh2-sftp-client'
import type { StorageBackend, FileEntry, FileMeta } from '../sync'

// Extend FileEntry to carry the backend reference for remote paths
export interface SftpEntry extends FileEntry {
  _backend: 'sftp'
}

export class SftpBackend implements StorageBackend {
  private client:    SftpClient
  private connected = false
  private host:      string
  private port:      number
  private username:  string
  private password?: string
  // TODO Phase 5: privateKey, passphrase, agent socket

  constructor(urlStr: string) {
    const url = new URL(urlStr)
    this.host     = url.hostname
    this.port     = parseInt(url.port) || 22
    this.username = decodeURIComponent(url.username)
    this.password = url.password ? decodeURIComponent(url.password) : undefined
    this.client   = new SftpClient('sync-tool')
  }

  // ── Connection lifecycle ─────────────────────────────────────────────────

  private async ensureConnected(): Promise<void> {
    if (this.connected) return
    await this.client.connect({
      host:          this.host,
      port:          this.port,
      username:      this.username,
      password:      this.password,
      readyTimeout:  10_000,
      // TODO Phase 5: privateKey: fs.readFileSync('~/.ssh/id_rsa')
    })
    this.connected = true
    console.log(`[sftp] Connected to ${this.username}@${this.host}:${this.port}`)
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.end()
      this.connected = false
    }
  }

  // ── StorageBackend implementation ────────────────────────────────────────

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
        const abs = `${dir}/${item.name}`.replace(/\/+/g, '/')
        const rel = abs.slice(rootPath.length).replace(/^\//, '')

        if (item.type === 'd') {
          entries.set(rel, {
            relativePath: rel, absolutePath: abs,
            size: 0, mtimeMs: 0, isDirectory: true,
          })
          await recurse(abs)
        } else if (item.type === '-') {
          entries.set(rel, {
            relativePath: rel, absolutePath: abs,
            size: item.size,
            mtimeMs: item.modifyTime,  // ssh2-sftp-client returns ms timestamp
            isDirectory: false,
          })
        }
        // type 'l' (symlink) — skip for now, TODO Phase 5
      }
    }

    await recurse(rootPath)
    return entries
  }

  async mkdirp(dirPath: string): Promise<void> {
    await this.ensureConnected()
    // ssh2-sftp-client mkdir with recursive flag
    const exists = await this.client.exists(dirPath)
    if (!exists) {
      await this.client.mkdir(dirPath, true)
    }
  }

  async read(filePath: string): Promise<NodeJS.ReadableStream> {
    await this.ensureConnected()
    // createReadStream returns a PassThrough stream backed by an SFTP download
    return this.client.createReadStream(filePath)
  }

  async write(filePath: string, stream: NodeJS.ReadableStream, meta: FileMeta): Promise<void> {
    await this.ensureConnected()

    // Ensure parent directory exists
    const parentDir = filePath.substring(0, filePath.lastIndexOf('/'))
    if (parentDir) await this.mkdirp(parentDir)

    // Upload stream to remote path
    await this.client.put(stream as any, filePath)

    // Preserve mtime
    // ssh2-sftp-client doesn't expose utimes; use the underlying ssh2 stat+setstat
    // This is best-effort — falls back silently on servers that reject it
    try {
      // Access underlying SSH2 sftp handle via (client as any).sftp
      const sftp = (this.client as any).sftp
      if (sftp) {
        const atimeMs = Date.now()
        await new Promise<void>((resolve, reject) => {
          sftp.setstat(filePath, {
            atime: Math.floor(atimeMs  / 1000),
            mtime: Math.floor(meta.mtimeMs / 1000),
          }, (err: Error) => err ? reject(err) : resolve())
        })
      }
    } catch {
      // mtime preservation not critical — skip silently
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Factory helper used by resolveBackend()
// ─────────────────────────────────────────────────────────────────────────────

export function createSftpBackend(urlStr: string): { backend: SftpBackend; remotePath: string } {
  const url = new URL(urlStr)
  return {
    backend:    new SftpBackend(urlStr),
    remotePath: url.pathname || '/',
  }
}
