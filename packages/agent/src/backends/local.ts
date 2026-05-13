import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import type { StorageBackend, FileEntry, FileMeta, WriteOptions } from '../sync'

export const localBackend: StorageBackend = {
  async walk(rootPath: string): Promise<Map<string, FileEntry>> {
    const entries = new Map<string, FileEntry>()

    async function recurse(currentDir: string) {
      let items: fs.Dirent[]
      try {
        items = await fs.promises.readdir(currentDir, { withFileTypes: true })
      } catch (err: any) {
        console.warn(`[local] Cannot read dir ${currentDir}: ${err.message}`)
        return
      }

      for (const item of items) {
        if (item.name === '_gsdata_') continue  // skip our own metadata directory

        const abs = path.join(currentDir, item.name)
        const rel = path.relative(rootPath, abs)

        if (item.isSymbolicLink()) continue

        if (item.isDirectory()) {
          entries.set(rel, {
            relativePath: rel,
            absolutePath: abs,
            size:         0,
            mtimeMs:      0,
            isDirectory:  true,
          })
          await recurse(abs)
        } else if (item.isFile()) {
          const stat = await fs.promises.stat(abs)
          entries.set(rel, {
            relativePath: rel,
            absolutePath: abs,
            size:         stat.size,
            mtimeMs:      stat.mtimeMs,
            isDirectory:  false,
          })
        }
      }
    }

    await recurse(rootPath)
    return entries
  },

  async mkdirp(dirPath: string): Promise<void> {
    await fs.promises.mkdir(dirPath, { recursive: true })
  },

  async read(filePath: string, options?: { start?: number }): Promise<NodeJS.ReadableStream> {
    return fs.createReadStream(filePath, options?.start ? { start: options.start } : undefined)
  },

  async partialSize(filePath: string, meta: FileMeta): Promise<number> {
    const partialPath = localPartialPath(filePath)
    try {
      const stat = await fs.promises.stat(partialPath)
      return stat.size > 0 && stat.size < meta.size ? stat.size : 0
    } catch {
      return 0
    }
  },

  async write(filePath: string, stream: NodeJS.ReadableStream, meta: FileMeta, options: WriteOptions = {}): Promise<void> {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    const targetPath = options.atomic ? localPartialPath(filePath) : filePath
    const flags = options.resumeOffset && options.resumeOffset > 0 ? 'a' : 'w'
    await pipeline(stream, fs.createWriteStream(targetPath, { flags }))

    if (options.expectedSize && !meta.encrypted) {
      const stat = await fs.promises.stat(targetPath)
      if (stat.size !== options.expectedSize) {
        throw new Error(`Partial write size mismatch: got ${stat.size}, expected ${options.expectedSize}`)
      }
    }

    const mtime = new Date(meta.mtimeMs)
    await fs.promises.utimes(targetPath, mtime, mtime)

    if (options.atomic) {
      await fs.promises.rename(targetPath, filePath)
    }
  },

  /**
   * Safe delete: moves file to _gsdata_/_saved_/ instead of hard-deleting.
   * User can recover it manually. GoodSync does the same.
   */
  async delete(filePath: string): Promise<void> {
    const dir      = path.dirname(filePath)
    const ext      = path.extname(filePath)
    const basename = path.basename(filePath, ext)
    const ts       = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)

    const savedDir  = path.join(dir, '_gsdata_', '_saved_')
    const savedPath = path.join(savedDir, `${basename}_${ts}${ext}`)

    await fs.promises.mkdir(savedDir, { recursive: true })

    try {
      await fs.promises.rename(filePath, savedPath)  // atomic, zero disk space
    } catch (err: any) {
      if (err.code === 'EXDEV') {
        // Cross-device (different mount points) — copy then unlink
        await fs.promises.copyFile(filePath, savedPath)
        await fs.promises.unlink(filePath)
      } else {
        throw err
      }
    }

    console.log(`[local] Safe-deleted → _gsdata_/_saved_/${path.basename(savedPath)}`)
  },

  async move(fromPath: string, toPath: string, meta: FileMeta): Promise<void> {
    await fs.promises.mkdir(path.dirname(toPath), { recursive: true })
    try {
      await fs.promises.rename(fromPath, toPath)
    } catch (err: any) {
      if (err.code !== 'EXDEV') throw err
      await fs.promises.copyFile(fromPath, toPath)
      await fs.promises.unlink(fromPath)
    }

    const mtime = new Date(meta.mtimeMs)
    await fs.promises.utimes(toPath, mtime, mtime)
  },

  localPath(filePath: string): string {
    return filePath
  },
}

function localPartialPath(filePath: string): string {
  const dir = path.dirname(filePath)
  const ext = path.extname(filePath)
  const basename = path.basename(filePath, ext)
  return path.join(dir, `${basename}.sync-tool-part${ext}`)
}
