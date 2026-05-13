import type { SyncResult, SyncProgress, Job } from '@sync-tool/shared'

// ─────────────────────────────────────────────────────────────────────────────
//  StorageBackend — stream-based interface
//
//  Every backend implements four methods. The sync engine pipes
//  srcBackend.read() → dstBackend.write(), so any pair of backends works.
//
//  Phase 1: LocalBackend   backends/local.ts
//  Phase 2: SftpBackend    backends/sftp.ts
//           FtpBackend     backends/ftp.ts
//           SmbBackend     backends/smb.ts  (macOS mount)
//  Phase 3: S3Backend      backends/s3.ts
//  Phase 4: replace read()/write() with block-level delta transfer
// ─────────────────────────────────────────────────────────────────────────────

export interface FileEntry {
  relativePath: string
  absolutePath: string
  size:         number
  mtimeMs:      number
  isDirectory:  boolean
}

export interface FileMeta {
  size:    number
  mtimeMs: number
}

export interface StorageBackend {
  walk(rootPath: string):                                                   Promise<Map<string, FileEntry>>
  mkdirp(dirPath: string):                                                  Promise<void>
  read(filePath: string):                                                   Promise<NodeJS.ReadableStream>
  write(filePath: string, stream: NodeJS.ReadableStream, meta: FileMeta):  Promise<void>
  close?():                                                                 Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
//  Cross-backend transfer — src backend reads, dst backend writes
// ─────────────────────────────────────────────────────────────────────────────

async function transferFile(
  srcEntry:   FileEntry,
  srcBackend: StorageBackend,
  dstPath:    string,
  dstBackend: StorageBackend,
): Promise<void> {
  const stream = await srcBackend.read(srcEntry.absolutePath)
  await dstBackend.write(dstPath, stream, { size: srcEntry.size, mtimeMs: srcEntry.mtimeMs })
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sync Engine
// ─────────────────────────────────────────────────────────────────────────────

const MTIME_TOLERANCE_MS = 2000

export async function runSync(
  job:        Job,
  srcBackend: StorageBackend,
  dstBackend: StorageBackend,
  srcPath:    string,
  dstPath:    string,
  onProgress: (p: Partial<SyncProgress>) => void = () => {},
): Promise<SyncResult> {
  const startedAt = Date.now()
  const result: SyncResult = {
    jobId: job.id, startedAt, endedAt: 0,
    filesCopied: 0, filesSkipped: 0, filesErrored: 0,
    bytesTransferred: 0, errors: [],
  }

  try {
    await srcBackend.mkdirp(srcPath)
    await dstBackend.mkdirp(dstPath)

    if (job.direction === 'bidir') {
      await syncBidirectional(job, srcBackend, dstBackend, srcPath, dstPath, result, onProgress)
    } else {
      const [A, B, bA, bB] = job.direction === 'rtl'
        ? [dstPath, srcPath, dstBackend, srcBackend]
        : [srcPath, dstPath, srcBackend, dstBackend]
      await syncOneWay(job, A, B, bA, bB, result, onProgress)
    }
  } finally {
    await srcBackend.close?.()
    if (dstBackend !== srcBackend) await dstBackend.close?.()
  }

  result.endedAt = Date.now()
  return result
}

async function syncOneWay(
  job: Job, srcPath: string, dstPath: string,
  srcBackend: StorageBackend, dstBackend: StorageBackend,
  result: SyncResult, onProgress: (p: Partial<SyncProgress>) => void,
) {
  const srcFiles = await srcBackend.walk(srcPath)
  const dstFiles = await dstBackend.walk(dstPath)
  const entries  = [...srcFiles.values()].filter((e) => !e.isDirectory)
  let   processed = 0

  for (const srcEntry of entries) {
    const dstEntry  = dstFiles.get(srcEntry.relativePath)
    const needsCopy = !dstEntry || srcEntry.mtimeMs > dstEntry.mtimeMs + MTIME_TOLERANCE_MS

    if (needsCopy) {
      try {
        await transferFile(srcEntry, srcBackend, joinRemote(dstPath, srcEntry.relativePath), dstBackend)
        result.filesCopied++
        result.bytesTransferred += srcEntry.size
      } catch (err: any) {
        result.filesErrored++
        result.errors.push(`${srcEntry.relativePath}: ${err.message}`)
      }
    } else {
      result.filesSkipped++
    }

    onProgress({ jobId: job.id, currentFile: srcEntry.relativePath,
      filesProcessed: ++processed, filesTotal: entries.length,
      bytesTransferred: result.bytesTransferred })
  }
}

async function syncBidirectional(
  job: Job, srcBackend: StorageBackend, dstBackend: StorageBackend,
  srcPath: string, dstPath: string,
  result: SyncResult, onProgress: (p: Partial<SyncProgress>) => void,
) {
  const srcFiles = await srcBackend.walk(srcPath)
  const dstFiles = await dstBackend.walk(dstPath)
  const allPaths = new Set([...srcFiles.keys(), ...dstFiles.keys()])
  const toProcess = [...allPaths].filter((rel) => !(srcFiles.get(rel)?.isDirectory || dstFiles.get(rel)?.isDirectory))
  let   processed = 0

  for (const rel of toProcess) {
    const s = srcFiles.get(rel), d = dstFiles.get(rel)
    try {
      if (s && !d) {
        await transferFile(s, srcBackend, joinRemote(dstPath, rel), dstBackend)
        result.filesCopied++; result.bytesTransferred += s.size
      } else if (!s && d) {
        await transferFile(d, dstBackend, joinRemote(srcPath, rel), srcBackend)
        result.filesCopied++; result.bytesTransferred += d.size
      } else if (s && d) {
        if (s.mtimeMs > d.mtimeMs + MTIME_TOLERANCE_MS) {
          await transferFile(s, srcBackend, joinRemote(dstPath, rel), dstBackend)
          result.filesCopied++; result.bytesTransferred += s.size
        } else if (d.mtimeMs > s.mtimeMs + MTIME_TOLERANCE_MS) {
          await transferFile(d, dstBackend, joinRemote(srcPath, rel), srcBackend)
          result.filesCopied++; result.bytesTransferred += d.size
        } else {
          result.filesSkipped++
        }
      }
    } catch (err: any) {
      result.filesErrored++
      result.errors.push(`${rel}: ${err.message}`)
    }

    onProgress({ jobId: job.id, currentFile: rel,
      filesProcessed: ++processed, filesTotal: toProcess.length,
      bytesTransferred: result.bytesTransferred })
  }
}

export function joinRemote(base: string, rel: string): string {
  const sep = base.includes('\\') ? '\\' : '/'
  return base.endsWith(sep) ? `${base}${rel}` : `${base}${sep}${rel}`
}
