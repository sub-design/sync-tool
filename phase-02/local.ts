import fs from 'fs'
import path from 'path'
import type { StorageBackend, FileEntry, FileMeta } from '../sync'

export const localBackend: StorageBackend = {

  async walk(rootPath: string): Promise<Map<string, FileEntry>> {
    const entries = new Map<string, FileEntry>()

    async function recurse(current: string) {
      let items: fs.Dirent[]
      try {
        items = await fs.promises.readdir(current, { withFileTypes: true })
      } catch (err: any) {
        console.warn(`[local] Cannot read ${current}: ${err.message}`)
        return
      }
      for (const item of items) {
        const abs = path.join(current, item.name)
        const rel = path.relative(rootPath, abs)
        if (item.isSymbolicLink()) continue  // TODO Phase 5
        if (item.isDirectory()) {
          entries.set(rel, { relativePath: rel, absolutePath: abs, size: 0, mtimeMs: 0, isDirectory: true })
          await recurse(abs)
        } else if (item.isFile()) {
          const stat = await fs.promises.stat(abs)
          entries.set(rel, { relativePath: rel, absolutePath: abs, size: stat.size, mtimeMs: stat.mtimeMs, isDirectory: false })
        }
      }
    }

    await recurse(rootPath)
    return entries
  },

  async mkdirp(dirPath: string): Promise<void> {
    await fs.promises.mkdir(dirPath, { recursive: true })
  },

  async read(filePath: string): Promise<NodeJS.ReadableStream> {
    return fs.createReadStream(filePath)
  },

  async write(filePath: string, stream: NodeJS.ReadableStream, meta: FileMeta): Promise<void> {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    await new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(filePath)
      stream.pipe(ws)
      ws.on('finish', resolve)
      ws.on('error', reject)
      ;(stream as NodeJS.EventEmitter).on('error', reject)
    })
    // Preserve source mtime so future syncs compare correctly
    const mtime = new Date(meta.mtimeMs)
    await fs.promises.utimes(filePath, mtime, mtime)
  },
}
