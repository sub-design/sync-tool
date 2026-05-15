import type { SyncResult, SyncProgress, Job } from '@sync-tool/shared'
import crypto from 'crypto'
import fs from 'fs'
import { Transform } from 'stream'
import pRetry from 'p-retry'
import { transferFileDelta } from './delta/engine'
import { streamSHA256 } from './delta/engine'
import type { StoredFileState, StateStore } from './state'
import { acquireLock, releaseLock, isLocalPath } from './lock'

// ─────────────────────────────────────────────────────────────────────────────
//  Storage backend contract
//
//  The sync engine moves data through streams:
//  srcBackend.read() -> dstBackend.write().
//  That keeps local, SFTP, SMB, NFS, and future cloud backends composable.
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
  encrypted?: boolean
}

export interface WriteOptions {
  atomic?: boolean
  resumeOffset?: number
  expectedSize?: number
}

export interface StorageBackend {
  walk(rootPath: string): Promise<Map<string, FileEntry>>
  mkdirp(dirPath: string): Promise<void>
  read(filePath: string, options?: { start?: number }): Promise<NodeJS.ReadableStream>
  write(filePath: string, stream: NodeJS.ReadableStream, meta: FileMeta, options?: WriteOptions): Promise<void>
  partialSize?(filePath: string, meta: FileMeta): Promise<number>
  delete?(filePath: string): Promise<void>
  move?(fromPath: string, toPath: string, meta: FileMeta): Promise<void>
  localPath?(filePath: string): string
  close?(): Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sync Engine
// ─────────────────────────────────────────────────────────────────────────────

const MTIME_TOLERANCE_MS = 2_000
const HOUR_MS            = 3_600_000
const DEFAULT_RETRY_ATTEMPTS = 3
const DEFAULT_RETRY_MIN_TIMEOUT_MS = 500
const ENCRYPTION_HEADER_MAGIC = Buffer.from('SYNCENC1')

// DST-aware mtime comparison: returns true if two timestamps represent the same file.
// FAT32 has 2-second resolution; Windows also shifts mtime by exactly ±1h or ±2h on
// daylight saving transitions — without this, every FAT32 file looks "changed" twice a year.
export function mtimeEqual(a: number, b: number): boolean {
  const diff = Math.abs(a - b)
  if (diff <= MTIME_TOLERANCE_MS)                           return true  // same (FAT32 res)
  if (Math.abs(diff -     HOUR_MS) <= MTIME_TOLERANCE_MS) return true  // DST ±1h
  if (Math.abs(diff - 2 * HOUR_MS) <= MTIME_TOLERANCE_MS) return true  // DST ±2h
  return false
}

export function fileChanged(
  entry: { size: number; mtimeMs: number } | undefined,
  prev:  StoredFileState | undefined,
  side:  'src' | 'dst',
): boolean {
  if (!entry) return false
  if (!prev)  return true                                 // no prior state → treat as new
  const prevSize  = side === 'src' ? prev.srcSize  : prev.dstSize
  const prevMtime = side === 'src' ? prev.srcMtimeMs : prev.dstMtimeMs
  if (prevSize === null || prevMtime === null) return true // newly appeared on this side
  return entry.size !== prevSize || !mtimeEqual(entry.mtimeMs, prevMtime)
}

type SyncAction = 'copy-to-dst' | 'copy-to-src' | 'delete-dst' | 'delete-src' | 'conflict' | 'skip'

export function resolveAction(
  src: { size: number; mtimeMs: number } | undefined,
  dst: { size: number; mtimeMs: number } | undefined,
  srcChanged: boolean, dstChanged: boolean,
  srcExisted: boolean, dstExisted: boolean,
  firstSync:  boolean,
): SyncAction {
  // First sync: no state → use existence + DST-aware newer-wins
  if (firstSync) {
    if  (src && !dst) return 'copy-to-dst'
    if (!src &&  dst) return 'copy-to-src'
    if  (src &&  dst) {
      if (mtimeEqual(src.mtimeMs, dst.mtimeMs)) return 'skip'
      return src.mtimeMs > dst.mtimeMs ? 'copy-to-dst' : 'copy-to-src'
    }
    return 'skip'
  }
  if (!src && !dst) return 'skip'
  if  (src && !dst) {
    if (!dstExisted) return 'copy-to-dst'   // new on src
    if (!srcChanged) return 'delete-src'    // dst deleted, src unchanged → follow dst
    return 'copy-to-dst'                    // src changed AND dst deleted → copy wins
  }
  if (!src &&  dst) {
    if (!srcExisted) return 'copy-to-src'   // new on dst
    if (!dstChanged) return 'delete-dst'    // src deleted, dst unchanged → follow src
    return 'copy-to-src'                    // dst changed AND src deleted → copy wins
  }
  // Both exist
  if (!srcChanged && !dstChanged) return 'skip'
  if ( srcChanged && !dstChanged) return 'copy-to-dst'
  if (!srcChanged &&  dstChanged) return 'copy-to-src'
  return 'conflict'
}

interface TransferStats {
  bytesTransferred: number
  logicalBytes:      number
  kind:              'delta' | 'full'
  checksum?:         string
}

export async function runSync(
  job:        Job,
  srcBackend: StorageBackend,
  dstBackend: StorageBackend,
  srcPath:    string,
  dstPath:    string,
  state:      StateStore,
  onProgress: (p: Partial<SyncProgress>) => void = () => {},
  signal?:     AbortSignal,
): Promise<SyncResult> {
  const startedAt = Date.now()
  const result: SyncResult = {
    jobId:            job.id,
    startedAt,
    endedAt:          0,
    filesCopied:      0,
    filesSkipped:     0,
    filesErrored:     0,
    conflictsPending: 0,
    bytesTransferred: 0,
    logicalBytes:     0,
    deltaBytes:       0,
    fullBytes:        0,
    deltaFiles:       0,
    fullFiles:        0,
    errors:           [],
  }

  const lockDir = isLocalPath(srcPath) ? srcPath : null
  if (lockDir) await acquireLock(lockDir, job.id)

  try {
    await srcBackend.mkdirp(srcPath)
    await dstBackend.mkdirp(dstPath)

    if (job.direction === 'bidir') {
      await syncBidirectional(job, srcBackend, dstBackend, srcPath, dstPath, state, result, onProgress, signal)
    } else {
      const [sourcePath, targetPath, sourceBackend, targetBackend] = job.direction === 'rtl'
        ? [dstPath, srcPath, dstBackend, srcBackend]
        : [srcPath, dstPath, srcBackend, dstBackend]

      await syncOneWay(job, sourcePath, targetPath, sourceBackend, targetBackend, result, onProgress, signal)
    }
  } finally {
    if (lockDir) await releaseLock(lockDir)
    result.endedAt = Date.now()
    await srcBackend.close?.()
    if (dstBackend !== srcBackend) await dstBackend.close?.()
  }

  return result
}

// ── One-way sync ──────────────────────────────────────────────────────────────

async function syncOneWay(
  job:        Job,
  srcPath:    string,
  dstPath:    string,
  srcBackend: StorageBackend,
  dstBackend: StorageBackend,
  result:     SyncResult,
  onProgress: (p: Partial<SyncProgress>) => void,
  signal?:     AbortSignal,
) {
  throwIfAborted(signal)
  const srcFiles = await srcBackend.walk(srcPath)
  throwIfAborted(signal)
  const dstFiles = await dstBackend.walk(dstPath)

  const entries = [...srcFiles.values()].filter((e) => !e.isDirectory)
  let processed = 0

  for (const srcEntry of entries) {
    throwIfAborted(signal)
    const dstEntry = dstFiles.get(srcEntry.relativePath)
    const encrypted = Boolean(job.reliability?.encryptionEnabled)
    const needsCopy = encrypted
      ? !dstEntry || (!mtimeEqual(srcEntry.mtimeMs, dstEntry.mtimeMs) && srcEntry.mtimeMs > dstEntry.mtimeMs)
      : !dstEntry
        || dstEntry.size !== srcEntry.size
        || (!mtimeEqual(srcEntry.mtimeMs, dstEntry.mtimeMs) && srcEntry.mtimeMs > dstEntry.mtimeMs)

    if (needsCopy) {
      try {
        const transferred = await transferFile(srcEntry, srcBackend, joinRemote(dstPath, srcEntry.relativePath), dstBackend, dstEntry, job, signal)
        result.filesCopied++
        applyTransferStats(result, transferred)
      } catch (err: any) {
        result.filesErrored++
        result.errors.push(`${srcEntry.relativePath}: ${err.message}`)
      }
    } else {
      result.filesSkipped++
    }

    processed++
    onProgress({
      jobId:            job.id,
      currentFile:      srcEntry.relativePath,
      filesProcessed:   processed,
      filesTotal:       entries.length,
      bytesTransferred: result.bytesTransferred,
    })
  }
}

// ── Bidirectional sync (state-based) ─────────────────────────────────────────

async function syncBidirectional(
  job:        Job,
  srcBackend: StorageBackend,
  dstBackend: StorageBackend,
  srcPath:    string,
  dstPath:    string,
  state:      StateStore,
  result:     SyncResult,
  onProgress: (p: Partial<SyncProgress>) => void,
  signal?:    AbortSignal,
) {
  throwIfAborted(signal)
  const srcFiles  = await srcBackend.walk(srcPath)
  throwIfAborted(signal)
  const dstFiles  = await dstBackend.walk(dstPath)

  const prevState     = state.getJobState(job.id)
  const newState      = new Map<string, StoredFileState>()
  let movedChecksums  = new Map<string, string>()
  if (!job.reliability?.encryptionEnabled) {
    movedChecksums = await detectAndApplyMoves(srcFiles, dstFiles, prevState, srcBackend, dstBackend, srcPath, dstPath, signal)
  }

  const allPaths      = new Set([...srcFiles.keys(), ...dstFiles.keys()])
  const entries       = [...allPaths].filter((rel) => !(srcFiles.get(rel)?.isDirectory || dstFiles.get(rel)?.isDirectory))
  let   processed     = 0
  let   conflictCount = 0

  for (const rel of entries) {
    throwIfAborted(signal)
    const srcEntry = srcFiles.get(rel)
    const dstEntry = dstFiles.get(rel)
    const prev     = prevState.get(rel)
    let stateSrcEntry = srcEntry
    let stateDstEntry = dstEntry
    let checksum = prev?.checksum ?? movedChecksums.get(rel)

    const firstSync  = !prev
    const srcChanged = fileChanged(srcEntry, prev, 'src')
    const dstChanged = fileChanged(dstEntry, prev, 'dst')
    const srcExisted = prev?.srcMtimeMs != null
    const dstExisted = prev?.dstMtimeMs != null

    let action = resolveAction(srcEntry, dstEntry, srcChanged, dstChanged, srcExisted, dstExisted, firstSync)

    if (action === 'conflict') {
      conflictCount++
      const strategy = job.conflictStrategy ?? 'newer-wins'

      if (strategy === 'newer-wins') {
        const msg = `CONFLICT ${rel} — both sides changed, applying newer-wins`
        console.warn(`[sync] ⚠ ${msg}`)
        result.errors.push(msg)
        action = (srcEntry && dstEntry && srcEntry.mtimeMs >= dstEntry.mtimeMs) ? 'copy-to-dst' : 'copy-to-src'
      } else if (strategy === 'skip') {
        console.warn(`[sync] ⚠ CONFLICT ${rel} — skipped (both sides changed)`)
        result.filesSkipped++
        action = 'skip'
      } else {
        // manual
        const msg = `CONFLICT:MANUAL ${rel} — needs manual resolution`
        console.warn(`[sync] ⚠ ${msg}`)
        result.errors.push(msg)
        result.conflictsPending = (result.conflictsPending ?? 0) + 1
        action = 'skip'
      }
    }

    try {
      switch (action) {
        case 'copy-to-dst':
          if (srcEntry) {
            const transferred = await transferFile(srcEntry, srcBackend, joinRemote(dstPath, rel), dstBackend, dstEntry, job, signal)
            result.filesCopied++
            applyTransferStats(result, transferred)
            stateDstEntry = srcEntry
            checksum = transferred.checksum ?? checksum
          }
          break

        case 'copy-to-src':
          if (dstEntry) {
            const transferred = await transferFile(dstEntry, dstBackend, joinRemote(srcPath, rel), srcBackend, srcEntry, job, signal)
            result.filesCopied++
            applyTransferStats(result, transferred)
            stateSrcEntry = dstEntry
            checksum = transferred.checksum ?? checksum
          }
          break

        case 'delete-dst':
          if (dstBackend.delete) {
            await dstBackend.delete(joinRemote(dstPath, rel))
            stateDstEntry = undefined
          } else {
            console.log(`[sync] Would safe-delete from dst (not supported for this backend): ${rel}`)
          }
          break

        case 'delete-src':
          if (srcBackend.delete) {
            await srcBackend.delete(joinRemote(srcPath, rel))
            stateSrcEntry = undefined
          } else {
            console.log(`[sync] Would safe-delete from src (not supported for this backend): ${rel}`)
          }
          break

        case 'skip':
          result.filesSkipped++
          break
      }
    } catch (err: any) {
      result.filesErrored++
      result.errors.push(`${rel}: ${err.message}`)
    }

    if (!checksum && !job.reliability?.encryptionEnabled && action === 'skip' && stateSrcEntry && stateDstEntry) {
      try {
        checksum = await backfillChecksum(rel, stateSrcEntry, stateDstEntry, srcBackend, dstBackend, prev, signal)
      } catch (err: any) {
        result.errors.push(`${rel}: checksum backfill skipped: ${err.message}`)
      }
    }

    newState.set(rel, {
      srcSize:    stateSrcEntry?.size    ?? null,
      srcMtimeMs: stateSrcEntry?.mtimeMs ?? null,
      dstSize:    stateDstEntry?.size    ?? null,
      dstMtimeMs: stateDstEntry?.mtimeMs ?? null,
      checksum,
      syncedAt:   Date.now(),
    })

    processed++
    onProgress({
      jobId:            job.id,
      currentFile:      rel,
      filesProcessed:   processed,
      filesTotal:       entries.length,
      bytesTransferred: result.bytesTransferred,
    })
  }

  state.setJobState(job.id, newState)
  if (conflictCount > 0) {
    const strategy = job.conflictStrategy ?? 'newer-wins'
    console.log(`[sync] ${conflictCount} conflict(s) handled by strategy: ${strategy}`)
  }
}

async function detectAndApplyMoves(
  srcFiles: Map<string, FileEntry>,
  dstFiles: Map<string, FileEntry>,
  prevState: Map<string, StoredFileState>,
  srcBackend: StorageBackend,
  dstBackend: StorageBackend,
  srcPath: string,
  dstPath: string,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const srcMoves = await detectSideMoves({
    changedFiles: srcFiles,
    mirrorFiles:  dstFiles,
    changedBackend: srcBackend,
    mirrorBackend:  dstBackend,
    mirrorRoot:     dstPath,
    prevState,
    changedSide: 'src',
    signal,
  })
  const dstMoves = await detectSideMoves({
    changedFiles: dstFiles,
    mirrorFiles:  srcFiles,
    changedBackend: dstBackend,
    mirrorBackend:  srcBackend,
    mirrorRoot:     srcPath,
    prevState,
    changedSide: 'dst',
    signal,
  })

  return new Map([...srcMoves, ...dstMoves])
}

interface MoveDetectionInput {
  changedFiles: Map<string, FileEntry>
  mirrorFiles: Map<string, FileEntry>
  changedBackend: StorageBackend
  mirrorBackend: StorageBackend
  mirrorRoot: string
  prevState: Map<string, StoredFileState>
  changedSide: 'src' | 'dst'
  signal?: AbortSignal
}

async function detectSideMoves(input: MoveDetectionInput): Promise<Map<string, string>> {
  const movedChecksums = new Map<string, string>()
  if (!input.mirrorBackend.move) return movedChecksums

  const missingByChecksum = new Map<string, string[]>()
  for (const [rel, prev] of input.prevState) {
    throwIfAborted(input.signal)
    if (input.changedFiles.has(rel) || !input.mirrorFiles.has(rel)) continue
    if (!existedOnBothSides(prev) || !prev.checksum) continue

    const mirrorEntry = input.mirrorFiles.get(rel)!
    if (fileChanged(mirrorEntry, prev, input.changedSide === 'src' ? 'dst' : 'src')) continue

    const prevSize = input.changedSide === 'src' ? prev.srcSize : prev.dstSize
    if (prevSize == null || mirrorEntry.size !== prevSize) continue

    const key = checksumMoveKey(prev.checksum, prevSize)
    const paths = missingByChecksum.get(key) ?? []
    paths.push(rel)
    missingByChecksum.set(key, paths)
  }

  const addedByChecksum = new Map<string, string[]>()
  for (const [rel, entry] of input.changedFiles) {
    throwIfAborted(input.signal)
    if (entry.isDirectory || input.mirrorFiles.has(rel) || input.prevState.has(rel)) continue

    const checksum = await streamSHA256(await input.changedBackend.read(entry.absolutePath))
    const key = checksumMoveKey(checksum, entry.size)
    const paths = addedByChecksum.get(key) ?? []
    paths.push(rel)
    addedByChecksum.set(key, paths)
  }

  for (const [key, addedPaths] of addedByChecksum) {
    throwIfAborted(input.signal)
    const missingPaths = missingByChecksum.get(key)
    if (!missingPaths || addedPaths.length !== 1 || missingPaths.length !== 1) continue

    const fromRel = missingPaths[0]
    const toRel = addedPaths[0]
    const toEntry = input.changedFiles.get(toRel)
    const mirrorEntry = input.mirrorFiles.get(fromRel)
    if (!toEntry || !mirrorEntry) continue

    await input.mirrorBackend.move(
      joinRemote(input.mirrorRoot, fromRel),
      joinRemote(input.mirrorRoot, toRel),
      { size: toEntry.size, mtimeMs: toEntry.mtimeMs },
    )

    input.mirrorFiles.delete(fromRel)
    input.mirrorFiles.set(toRel, {
      ...mirrorEntry,
      relativePath: toRel,
      absolutePath: joinRemote(input.mirrorRoot, toRel),
      size:         toEntry.size,
      mtimeMs:      toEntry.mtimeMs,
    })
    movedChecksums.set(toRel, key.slice(0, key.lastIndexOf(':')))
  }

  return movedChecksums
}

function existedOnBothSides(prev: StoredFileState): boolean {
  return prev.srcSize != null && prev.srcMtimeMs != null && prev.dstSize != null && prev.dstMtimeMs != null
}

function checksumMoveKey(checksum: string, size: number): string {
  return `${checksum}:${size}`
}

async function backfillChecksum(
  rel: string,
  srcEntry: FileEntry,
  dstEntry: FileEntry,
  srcBackend: StorageBackend,
  dstBackend: StorageBackend,
  prev: StoredFileState | undefined,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (!prev || !existedOnBothSides(prev)) return undefined
  if (srcEntry.size !== dstEntry.size) return undefined
  if (fileChanged(srcEntry, prev, 'src') || fileChanged(dstEntry, prev, 'dst')) return undefined

  throwIfAborted(signal)
  const [srcHash, dstHash] = await Promise.all([
    streamSHA256(await srcBackend.read(srcEntry.absolutePath)),
    streamSHA256(await dstBackend.read(dstEntry.absolutePath)),
  ])
  await Promise.all([
    assertEntryStable(srcEntry, srcBackend, 'source'),
    assertEntryStable(dstEntry, dstBackend, 'destination'),
  ])

  if (srcHash !== dstHash) {
    throw new Error(`source/destination checksum mismatch for ${rel}`)
  }
  return srcHash
}

async function assertEntryStable(entry: FileEntry, backend: StorageBackend, label: string): Promise<void> {
  const localPath = backend.localPath?.(entry.absolutePath)
  if (!localPath) return

  const stat = await fs.promises.stat(localPath)
  if (stat.size !== entry.size || !mtimeEqual(stat.mtimeMs, entry.mtimeMs)) {
    throw new Error(`${label} changed while hashing`)
  }
}

async function transferFile(
  srcEntry:   FileEntry,
  srcBackend: StorageBackend,
  dstPath:    string,
  dstBackend: StorageBackend,
  dstEntry?:   FileEntry,
  job?:        Job,
  signal?:     AbortSignal,
): Promise<TransferStats> {
  const mode = job?.transferMode ?? 'auto'
  const encrypted = Boolean(job?.reliability?.encryptionEnabled)
  const retryOptions = retryOptionsFor(job)

  throwIfAborted(signal)
  if (!encrypted && mode !== 'full' && dstEntry) {
    const delta = await withRetry(() => transferFileDelta({
        srcEntry,
        srcBackend,
        dstEntry,
        dstBackend,
        dstPath,
        mode,
      }),
      retryOptions,
      signal,
    )

    if (delta.applied) {
      return {
        bytesTransferred: delta.bytesTransferred,
        logicalBytes:      srcEntry.size,
        kind:              'delta',
        checksum:          delta.checksum,
      }
    }
  }

  if (mode === 'delta') {
    throw new Error('Delta transfer is not available for this backend pair')
  }

  throwIfAborted(signal)
  const resumeEnabled = Boolean(job?.reliability?.resumeEnabled) && !encrypted
  const resumeOffset = resumeEnabled
    ? await withRetry(() => dstBackend.partialSize?.(dstPath, { size: srcEntry.size, mtimeMs: srcEntry.mtimeMs }) ?? Promise.resolve(0), retryOptions, signal)
    : 0

  await withRetry(async () => {
    throwIfAborted(signal)
    let stream = await srcBackend.read(srcEntry.absolutePath, resumeOffset > 0 ? { start: resumeOffset } : undefined)
    stream = applyReliabilityTransforms(stream, job, signal)
    await dstBackend.write(
      dstPath,
      stream,
      { size: srcEntry.size, mtimeMs: srcEntry.mtimeMs, encrypted },
      { atomic: true, resumeOffset, expectedSize: srcEntry.size },
    )
  }, retryOptions, signal)

  if (!encrypted) {
    throwIfAborted(signal)
    const checksum = await withRetry(() => verifyBackendCopy(srcEntry.absolutePath, srcBackend, dstPath, dstBackend), retryOptions, signal)
    return {
      bytesTransferred: Math.max(0, srcEntry.size - resumeOffset),
      logicalBytes:      srcEntry.size,
      kind:              'full',
      checksum,
    }
  }

  return {
    bytesTransferred: Math.max(0, srcEntry.size - resumeOffset),
    logicalBytes:      srcEntry.size,
    kind:              'full',
  }
}

function applyReliabilityTransforms(
  stream: NodeJS.ReadableStream,
  job: Job | undefined,
  signal?: AbortSignal,
): NodeJS.ReadableStream {
  let output = stream
  const bandwidthLimitBps = job?.reliability?.bandwidthLimitBps
  if (bandwidthLimitBps && bandwidthLimitBps > 0) {
    output = output.pipe(new TokenBucketThrottle(bandwidthLimitBps, signal))
  }

  if (job?.reliability?.encryptionEnabled) {
    output = output.pipe(createEncryptionStream(job))
  }

  return output
}

function createEncryptionStream(job: Job): NodeJS.ReadWriteStream {
  const key = encryptionKey(job)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  let headerSent = false

  return new Transform({
    transform(chunk, _encoding, callback) {
      try {
        if (!headerSent) {
          headerSent = true
          this.push(Buffer.concat([ENCRYPTION_HEADER_MAGIC, iv]))
        }
        this.push(cipher.update(chunk))
        callback()
      } catch (err: any) {
        callback(err)
      }
    },
    flush(callback) {
      try {
        this.push(cipher.final())
        this.push(cipher.getAuthTag())
        callback()
      } catch (err: any) {
        callback(err)
      }
    },
  })
}

function encryptionKey(job: Job): Buffer {
  const keyId = job.reliability?.encryptionKeyId
  const envName = keyId ? `SYNC_ENCRYPTION_KEY_${keyId}` : 'SYNC_ENCRYPTION_KEY'
  const raw = process.env[envName] ?? process.env.SYNC_ENCRYPTION_KEY
  if (!raw) throw new Error(`Encryption is enabled but ${envName} is not set`)

  const decoded = /^[a-f0-9]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64')
  if (decoded.length !== 32) throw new Error(`${envName} must decode to a 32-byte AES-256 key`)
  return decoded
}

class TokenBucketThrottle extends Transform {
  private tokens: number
  private lastRefill = Date.now()

  constructor(private readonly bytesPerSecond: number, private readonly signal?: AbortSignal) {
    super()
    this.tokens = bytesPerSecond
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void) {
    this.waitForTokens(chunk.length)
      .then(() => callback(null, chunk))
      .catch(callback)
  }

  private async waitForTokens(bytes: number): Promise<void> {
    const capacity = Math.max(this.bytesPerSecond, bytes)
    while (this.tokens < bytes) {
      throwIfAborted(this.signal)
      this.refill(capacity)
      const deficit = bytes - this.tokens
      const waitMs = Math.ceil((deficit / this.bytesPerSecond) * 1000)
      await sleep(Math.min(Math.max(waitMs, 10), 1000), this.signal)
    }
    this.tokens -= bytes
  }

  private refill(capacity = this.bytesPerSecond): void {
    const now = Date.now()
    const elapsedMs = now - this.lastRefill
    this.lastRefill = now
    this.tokens = Math.min(capacity, this.tokens + (elapsedMs / 1000) * this.bytesPerSecond)
  }
}

function retryOptionsFor(job: Job | undefined) {
  return {
    retries: Math.max(0, job?.reliability?.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS),
    minTimeout: Math.max(1, job?.reliability?.retryMinTimeoutMs ?? DEFAULT_RETRY_MIN_TIMEOUT_MS),
    factor: 2,
  }
}

async function withRetry<T>(
  operation: () => Promise<T>,
  options: { retries: number; minTimeout: number; factor: number },
  signal?: AbortSignal,
): Promise<T> {
  return pRetry(async () => {
    throwIfAborted(signal)
    return operation()
  }, {
    retries: options.retries,
    minTimeout: options.minTimeout,
    factor: options.factor,
    onFailedAttempt: () => throwIfAborted(signal),
  })
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Sync cancelled'))
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('Sync cancelled'))
    }, { once: true })
  })
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new Error('Sync cancelled')
}

async function verifyBackendCopy(
  srcPath: string,
  srcBackend: StorageBackend,
  dstPath: string,
  dstBackend: StorageBackend,
): Promise<string> {
  const [srcHash, dstHash] = await Promise.all([
    streamSHA256(await srcBackend.read(srcPath)),
    streamSHA256(await dstBackend.read(dstPath)),
  ])

  if (srcHash !== dstHash) {
    throw new Error(`Full-copy SHA-256 mismatch: got ${dstHash}, expected ${srcHash}`)
  }
  return srcHash
}

function applyTransferStats(result: SyncResult, stats: TransferStats) {
  result.bytesTransferred += stats.bytesTransferred
  result.logicalBytes = (result.logicalBytes ?? 0) + stats.logicalBytes

  if (stats.kind === 'delta') {
    result.deltaBytes = (result.deltaBytes ?? 0) + stats.bytesTransferred
    result.deltaFiles = (result.deltaFiles ?? 0) + 1
  } else {
    result.fullBytes = (result.fullBytes ?? 0) + stats.bytesTransferred
    result.fullFiles = (result.fullFiles ?? 0) + 1
  }
}

export function joinRemote(base: string, rel: string): string {
  if (!rel) return base

  const sep = base.includes('\\') ? '\\' : '/'
  return base.endsWith(sep) ? `${base}${rel}` : `${base}${sep}${rel}`
}
