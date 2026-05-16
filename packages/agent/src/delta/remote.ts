import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import type { Job, SyncProgress, SyncResult } from '@sync-tool/shared'
import { resolveBackend } from '../backends/resolve'
import { joinRemote, throwIfAborted, mtimeEqual, fileChanged, resolveAction, type FileEntry, type StorageBackend } from '../sync'
import type { StateStore, StoredFileState } from '../state'
import { RelayClient } from '../relayClient'
import { ensureSignature, fileSHA256, resolveEnginePath, runEngine, streamSHA256 } from './engine'
import { assertAllowedLocalEndpoint } from '../fileGuard'

const DEFAULT_BLOCK_SIZE = 64 * 1024
const RELAY_CHUNK_BYTES = 512 * 1024
const TRANSFER_SESSION_TTL_MS = 30 * 60 * 1000
const TRANSFER_SESSION_SWEEP_MS = 5 * 60 * 1000

interface RemoteManifestEntry {
  relativePath: string
  absolutePath: string
  size: number
  mtimeMs: number
}

type StateFileSnapshot = Pick<FileEntry, 'size' | 'mtimeMs'> | RemoteManifestEntry

interface TransferSession {
  id: string
  kind: 'delta' | 'full'
  root: string
  relativePath: string
  meta: { size: number; mtimeMs: number }
  tempPath: string
  nextSeq: number
  updatedAt: number
  writeChain: Promise<void>
  writeError?: Error
  expectedSHA256?: string
}

interface RemoteTransferStats {
  bytesTransferred: number
  kind: 'delta' | 'full'
  checksum?: string
}

const transferSessions = new Map<string, TransferSession>()
let transferSessionSweeperStarted = false

// Fetches the full remote manifest page-by-page to avoid hitting the 3 MB relay message limit.
async function fetchRemoteManifest(
  relay:    RelayClient,
  deviceId: string,
  root:     string,
  signal?:  AbortSignal,
): Promise<Map<string, RemoteManifestEntry>> {
  const result = new Map<string, RemoteManifestEntry>()
  let cursor: number | undefined = undefined
  do {
    throwIfAborted(signal)
    const page = await relay.request(deviceId, 'delta:manifest', { root, cursor }) as {
      entries: RemoteManifestEntry[]
      nextCursor?: number
      total: number
    }
    for (const entry of page.entries) result.set(entry.relativePath, entry)
    cursor = page.nextCursor
  } while (cursor !== undefined)
  return result
}

export function canRunRemoteDelta(job: Job, deviceId: string, relay?: RelayClient): boolean {
  if (!isRemoteDeltaJob(job)) return false
  if (!relay?.isReady()) return false
  return initiatingDeviceId(job) === deviceId
}

export function isRemoteDeltaJob(job: Job): boolean {
  if (!job.sourceDeviceId || !job.destinationDeviceId) return false
  return true
}

export async function runRemoteDeltaSync(
  job: Job,
  relay: RelayClient,
  state: StateStore,
  onProgress: (p: Partial<SyncProgress>) => void = () => {},
  signal?: AbortSignal,
): Promise<SyncResult> {
  const startedAt = Date.now()
  const result: SyncResult = {
    jobId:            job.id,
    startedAt,
    endedAt:          0,
    filesCopied:      0,
    filesSkipped:     0,
    filesErrored:     0,
    bytesTransferred: 0,
    logicalBytes:      0,
    deltaBytes:        0,
    fullBytes:         0,
    deltaFiles:        0,
    fullFiles:         0,
    transportMode:    'relay',
    errors:           [],
  }

  if (job.direction === 'bidir') {
    return runRemoteBidirectionalSync(job, relay, state, result, onProgress, signal)
  }

  const sourceLocation = job.direction === 'rtl' ? job.destination : job.source
  const targetLocation = job.direction === 'rtl' ? job.source : job.destination
  const targetDeviceId = job.direction === 'rtl' ? job.sourceDeviceId! : job.destinationDeviceId!
  await assertAllowedLocalEndpoint(sourceLocation)
  const source = resolveBackend(sourceLocation)
  try {
    throwIfAborted(signal)
    await source.backend.mkdirp(source.rootPath)
    const [sourceFiles, targetFiles] = await Promise.all([
      source.backend.walk(source.rootPath),
      fetchRemoteManifest(relay, targetDeviceId, targetLocation, signal),
    ])
    const prevState    = state.getJobState(job.id)
    const newState     = new Map<string, StoredFileState>()

    // Detect source-side renames and emit delta:move on target instead of delete+re-upload.
    // targetFiles is mutated in place: old path removed, new path added.
    const movedChecksums = await detectRemoteSideMoves({
      changedFiles:   sourceFiles,
      mirrorFiles:    targetFiles,
      prevState,
      changedSide:    'src',
      changedBackend: source.backend,
      moveMirror: async (fromRel, toRel, entry) => {
        await relay.request(targetDeviceId, 'delta:move', {
          root: targetLocation, fromRelativePath: fromRel, toRelativePath: toRel,
          meta: { size: entry.size, mtimeMs: entry.mtimeMs },
        })
        console.log(`[remote] Rename ${fromRel} → ${toRel} (${entry.size} bytes saved)`)
      },
      mirrorRoot: targetLocation,
      signal,
    })

    const entries  = [...sourceFiles.values()].filter((entry) => !entry.isDirectory)
    let   processed = 0

    for (const sourceEntry of entries) {
      throwIfAborted(signal)
      const targetEntry = targetFiles.get(sourceEntry.relativePath)
      const needsCopy = !targetEntry
        || targetEntry.size !== sourceEntry.size
        || (!mtimeEqual(sourceEntry.mtimeMs, targetEntry.mtimeMs) && sourceEntry.mtimeMs > targetEntry.mtimeMs)

      let transferred: RemoteTransferStats | undefined
      if (needsCopy) {
        try {
          transferred = targetEntry
            ? await transferRemoteDelta(relay, targetDeviceId, sourceEntry, source.backend, targetLocation, job.transferMode ?? 'auto', signal)
            : await transferRemoteFull(relay, targetDeviceId, sourceEntry, source.backend, targetLocation, signal)

          result.filesCopied++
          applyRemoteTransferStats(result, sourceEntry.size, transferred)
        } catch (err: any) {
          result.filesErrored++
          result.errors.push(`${sourceEntry.relativePath}: ${err.message}`)
        }
      } else {
        result.filesSkipped++
      }

      // Persist checksum so rename detection works on the next sync run.
      newState.set(sourceEntry.relativePath, {
        srcSize:    sourceEntry.size,
        srcMtimeMs: sourceEntry.mtimeMs,
        dstSize:    targetEntry?.size    ?? sourceEntry.size,
        dstMtimeMs: targetEntry?.mtimeMs ?? sourceEntry.mtimeMs,
        checksum:   transferred?.checksum
          ?? movedChecksums.get(sourceEntry.relativePath)
          ?? prevState.get(sourceEntry.relativePath)?.checksum,
        syncedAt:   Date.now(),
      })

      processed++
      onProgress({
        jobId:            job.id,
        currentFile:      sourceEntry.relativePath,
        filesProcessed:   processed,
        filesTotal:       entries.length,
        bytesTransferred: result.bytesTransferred,
      })
    }

    // Delete orphaned destination files according to deletion_policy.
    const deletionPolicy = job.deletionPolicy ?? 'backup'
    if (deletionPolicy !== 'backup') {
      for (const [rel, targetEntry] of targetFiles) {
        if (sourceFiles.has(rel)) continue

        const shouldDelete = deletionPolicy === 'mirror'
          || (() => {
            // 'backup-with-deletes': remove only files that were previously tracked
            // as present on both sides and haven't changed locally on dst.
            const prev = prevState.get(rel)
            return !!prev
              && prev.srcMtimeMs != null
              && targetEntry.size === (prev.dstSize ?? null)
              && mtimeEqual(targetEntry.mtimeMs, prev.dstMtimeMs ?? 0)
          })()

        if (!shouldDelete) continue
        throwIfAborted(signal)

        try {
          await relay.request(targetDeviceId, 'delta:delete', { root: targetLocation, relativePath: rel })
          result.filesDeleted = (result.filesDeleted ?? 0) + 1
        } catch (err: any) {
          result.filesErrored++
          result.errors.push(`${rel}: ${err.message}`)
        }
      }
    }

    state.setJobState(job.id, newState)
  } finally {
    result.endedAt = Date.now()
    result.transportMode = relay.getTransportMode(targetDeviceId)
    await source.backend.close?.()
  }

  return result
}

async function runRemoteBidirectionalSync(
  job: Job,
  relay: RelayClient,
  state: StateStore,
  result: SyncResult,
  onProgress: (p: Partial<SyncProgress>) => void,
  signal?: AbortSignal,
): Promise<SyncResult> {
  const source              = resolveBackend(job.source)
  const destinationDeviceId = job.destinationDeviceId!

  try {
    await assertAllowedLocalEndpoint(job.source)
    throwIfAborted(signal)
    await source.backend.mkdirp(source.rootPath)
    const [sourceFiles, targetFiles] = await Promise.all([
      source.backend.walk(source.rootPath),
      fetchRemoteManifest(relay, destinationDeviceId, job.destination, signal),
    ])
    const prevState     = state.getJobState(job.id)
    const newState      = new Map<string, StoredFileState>()
    const movedChecksums = await detectAndApplyRemoteMoves({
      sourceFiles,
      targetFiles,
      prevState,
      sourceBackend: source.backend,
      sourceRoot: source.rootPath,
      relay,
      targetDeviceId: destinationDeviceId,
      targetRoot: job.destination,
      signal,
    })
    const allPaths      = new Set([...sourceFiles.keys(), ...targetFiles.keys()])
    const entries       = [...allPaths].filter((rel) => !(sourceFiles.get(rel)?.isDirectory))
    let   processed     = 0
    let   conflictCount = 0

    for (const rel of entries) {
      throwIfAborted(signal)
      const sourceEntry = sourceFiles.get(rel)
      const targetEntry = targetFiles.get(rel)
      const prev        = prevState.get(rel)
      let stateSourceEntry: StateFileSnapshot | undefined = sourceEntry
      let stateTargetEntry: StateFileSnapshot | undefined = targetEntry
      let checksum = prev?.checksum ?? movedChecksums.get(rel)

      const firstSync   = !prev
      const srcChanged  = fileChanged(sourceEntry, prev, 'src')
      const dstChanged  = fileChanged(targetEntry, prev, 'dst')
      const srcExisted  = prev?.srcMtimeMs != null
      const dstExisted  = prev?.dstMtimeMs != null

      let action = resolveAction(sourceEntry, targetEntry, srcChanged, dstChanged, srcExisted, dstExisted, firstSync)

      if (action === 'conflict') {
        conflictCount++
        const msg = `CONFLICT ${rel} — both sides changed, applying newer-wins`
        console.warn(`[remote] ⚠ ${msg}`)
        result.errors.push(msg)
        action = (sourceEntry && targetEntry && sourceEntry.mtimeMs >= targetEntry.mtimeMs) ? 'copy-to-dst' : 'copy-to-src'
      }

      try {
        switch (action) {
          case 'copy-to-dst':
            if (sourceEntry) {
              const transferred = targetEntry
                ? await transferRemoteDelta(relay, destinationDeviceId, sourceEntry, source.backend, job.destination, job.transferMode ?? 'auto', signal)
                : await transferRemoteFull(relay, destinationDeviceId, sourceEntry, source.backend, job.destination, signal)
              result.filesCopied++
              applyRemoteTransferStats(result, sourceEntry.size, transferred)
              stateTargetEntry = sourceEntry
              checksum = transferred.checksum ?? checksum
            }
            break

          case 'copy-to-src':
            if (targetEntry) {
              const transferred = sourceEntry
                ? await requestRemoteDeltaSend(relay, destinationDeviceId, job.destination, rel, sourceEntry, source.backend, job.source, job.transferMode ?? 'auto', signal)
                : await requestRemoteFullSend(relay, destinationDeviceId, job.destination, rel, job.source, 'full', signal)
              result.filesCopied++
              applyRemoteTransferStats(result, targetEntry.size, transferred)
              stateSourceEntry = targetEntry
              checksum = transferred.checksum ?? checksum
            }
            break

          case 'delete-dst':
            await relay.request(destinationDeviceId, 'delta:delete', { root: job.destination, relativePath: rel })
            result.filesDeleted = (result.filesDeleted ?? 0) + 1
            stateSourceEntry = undefined
            break

          case 'delete-src':
            if (source.backend.delete) {
              await source.backend.delete(joinRemote(source.rootPath, rel))
              stateSourceEntry = undefined
            } else {
              console.log(`[remote] Would safe-delete from src (not supported for this backend): ${rel}`)
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

      newState.set(rel, {
        srcSize:    stateSourceEntry?.size    ?? null,
        srcMtimeMs: stateSourceEntry?.mtimeMs ?? null,
        dstSize:    stateTargetEntry?.size    ?? null,
        dstMtimeMs: stateTargetEntry?.mtimeMs ?? null,
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
    if (conflictCount > 0) console.log(`[remote] ${conflictCount} conflict(s) resolved by newer-wins tiebreaker`)
  } finally {
    result.endedAt = Date.now()
    result.transportMode = relay.getTransportMode(destinationDeviceId)
    await source.backend.close?.()
  }

  return result
}

export function registerRemoteDeltaHandlers(relay: RelayClient) {
  startTransferSessionSweeper()
  relay.onRequest(async (from, method, body) => {
    validateRemoteDeltaRequest(method, body)
    switch (method) {
      case 'delta:manifest':
        return handleManifest(body.root, body.cursor)
      case 'delta:signature':
        return handleSignature(body.root, body.relativePath)
      case 'delta:transfer-start':
        return handleTransferStart(body.kind, body.root, body.relativePath, body.meta, body.proposedId)
      case 'delta:transfer-chunk':
        return handleTransferChunk(body.transferId, body.seq, body.dataBase64)
      case 'delta:transfer-finish':
        return handleTransferFinish(body.transferId, body.expectedSHA256)
      case 'delta:transfer-abort':
        return handleTransferAbort(body.transferId)
      case 'delta:send-full':
        return handleSendFull(relay, from, body.root, body.relativePath, body.targetRoot)
      case 'delta:send-delta':
        return handleSendDelta(relay, from, body.root, body.relativePath, body.targetRoot, body.signature, body.mode)
      case 'delta:move':
        return handleMove(body.root, body.fromRelativePath, body.toRelativePath, body.meta)
      case 'delta:delete':
        return handleDelete(body.root, body.relativePath)
      default:
        throw new Error(`Unsupported relay method: ${method}`)
    }
  })
}

export { handleTransferStart, handleTransferChunk, handleTransferFinish, handleTransferAbort, handleDelete }

export function validateRemoteDeltaRequest(method: string, body: any): void {
  if (!isRecord(body)) throw new Error(`Invalid relay ${method} body`)

  switch (method) {
    case 'delta:manifest':
      requireString(body, 'root')
      if (body.cursor !== undefined && typeof body.cursor !== 'number') throw new Error('delta:manifest cursor must be a number')
      return

    case 'delta:signature':
      requireString(body, 'root')
      requireString(body, 'relativePath')
      return

    case 'delta:transfer-start':
      if (body.kind !== 'delta' && body.kind !== 'full') throw new Error('Invalid transfer kind')
      requireString(body, 'root')
      requireString(body, 'relativePath')
      if (body.proposedId !== undefined && typeof body.proposedId !== 'string') throw new Error('Invalid proposedId')
      requireTransferMeta(body.meta)
      return

    case 'delta:transfer-chunk':
      requireString(body, 'transferId')
      requireNumber(body, 'seq')
      requireString(body, 'dataBase64')
      return

    case 'delta:transfer-finish':
      requireString(body, 'transferId')
      if (body.expectedSHA256 !== undefined && typeof body.expectedSHA256 !== 'string') throw new Error('Invalid expectedSHA256')
      return

    case 'delta:transfer-abort':
      requireString(body, 'transferId')
      return

    case 'delta:send-full':
      requireString(body, 'root')
      requireString(body, 'relativePath')
      requireString(body, 'targetRoot')
      return

    case 'delta:send-delta':
      requireString(body, 'root')
      requireString(body, 'relativePath')
      requireString(body, 'targetRoot')
      if (body.mode !== 'auto' && body.mode !== 'delta' && body.mode !== 'full') throw new Error('Invalid transfer mode')
      if (!isRecord(body.signature)) throw new Error('Invalid signature')
      return

    case 'delta:move':
      requireString(body, 'root')
      requireString(body, 'fromRelativePath')
      requireString(body, 'toRelativePath')
      requireTransferMeta(body.meta)
      return

    case 'delta:delete':
      requireString(body, 'root')
      requireString(body, 'relativePath')
      assertSafeRelativePath(body.relativePath as string)
      return

    default:
      return
  }
}

function requireTransferMeta(value: unknown): void {
  if (!isRecord(value)) throw new Error('Invalid transfer meta')
  if (typeof value.size !== 'number' || !Number.isFinite(value.size) || value.size < 0) throw new Error('Invalid transfer size')
  if (typeof value.mtimeMs !== 'number' || !Number.isFinite(value.mtimeMs)) throw new Error('Invalid transfer mtime')
}

function requireString(value: Record<string, unknown>, key: string): void {
  if (typeof value[key] !== 'string' || value[key].length === 0) throw new Error(`Invalid ${key}`)
}

function requireNumber(value: Record<string, unknown>, key: string): void {
  if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) throw new Error(`Invalid ${key}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface RemoteMoveInput {
  sourceFiles: Map<string, FileEntry>
  targetFiles: Map<string, RemoteManifestEntry>
  prevState: Map<string, StoredFileState>
  sourceBackend: StorageBackend
  sourceRoot: string
  relay: RelayClient
  targetDeviceId: string
  targetRoot: string
  signal?: AbortSignal
}

async function detectAndApplyRemoteMoves(input: RemoteMoveInput): Promise<Map<string, string>> {
  const sourceMoves = await detectRemoteSideMoves({
    changedFiles: input.sourceFiles,
    mirrorFiles: input.targetFiles,
    prevState: input.prevState,
    changedSide: 'src',
    changedBackend: input.sourceBackend,
    moveMirror: async (fromRel, toRel, entry) => {
      await input.relay.request(input.targetDeviceId, 'delta:move', {
        root: input.targetRoot,
        fromRelativePath: fromRel,
        toRelativePath: toRel,
        meta: { size: entry.size, mtimeMs: entry.mtimeMs },
      })
    },
    mirrorRoot: input.targetRoot,
    signal: input.signal,
  })

  const targetMoves = await detectRemoteSideMoves({
    changedFiles: input.targetFiles,
    mirrorFiles: input.sourceFiles,
    prevState: input.prevState,
    changedSide: 'dst',
    changedBackend: undefined,
    moveMirror: async (fromRel, toRel, entry) => {
      if (!input.sourceBackend.move) throw new Error('source backend does not support move')
      await input.sourceBackend.move(
        joinRemote(input.sourceRoot, fromRel),
        joinRemote(input.sourceRoot, toRel),
        { size: entry.size, mtimeMs: entry.mtimeMs },
      )
    },
    mirrorRoot: input.sourceRoot,
    signal: input.signal,
  })

  return new Map([...sourceMoves, ...targetMoves])
}

interface RemoteSideMoveInput {
  changedFiles: Map<string, FileEntry | RemoteManifestEntry>
  mirrorFiles: Map<string, FileEntry | RemoteManifestEntry>
  prevState: Map<string, StoredFileState>
  changedSide: 'src' | 'dst'
  changedBackend?: StorageBackend
  moveMirror: (fromRel: string, toRel: string, entry: FileEntry | RemoteManifestEntry) => Promise<void>
  mirrorRoot: string
  signal?: AbortSignal
}

export async function detectRemoteSideMoves(input: RemoteSideMoveInput): Promise<Map<string, string>> {
  const movedChecksums = new Map<string, string>()
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
    if (input.mirrorFiles.has(rel) || input.prevState.has(rel)) continue

    const checksum = input.changedSide === 'src'
      ? await streamSHA256(await input.changedBackend!.read((entry as FileEntry).absolutePath))
      : checksumForRemoteAddedEntry(rel, entry, input.prevState)
    if (!checksum) continue

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

    await input.moveMirror(fromRel, toRel, toEntry)
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

function checksumForRemoteAddedEntry(
  rel: string,
  entry: FileEntry | RemoteManifestEntry,
  prevState: Map<string, StoredFileState>,
): string | undefined {
  const candidates: string[] = []
  for (const [, prev] of prevState) {
    if (!prev.checksum || prev.dstSize !== entry.size) continue
    candidates.push(prev.checksum)
  }
  const unique = [...new Set(candidates)]
  return unique.length === 1 ? unique[0] : undefined
}

function existedOnBothSides(prev: StoredFileState): boolean {
  return prev.srcSize != null && prev.srcMtimeMs != null && prev.dstSize != null && prev.dstMtimeMs != null
}

function checksumMoveKey(checksum: string, size: number): string {
  return `${checksum}:${size}`
}

function applyRemoteTransferStats(result: SyncResult, logicalBytes: number, stats: RemoteTransferStats) {
  result.logicalBytes = (result.logicalBytes ?? 0) + logicalBytes
  result.bytesTransferred += stats.bytesTransferred
  if (stats.kind === 'delta') {
    result.deltaBytes = (result.deltaBytes ?? 0) + stats.bytesTransferred
    result.deltaFiles = (result.deltaFiles ?? 0) + 1
  } else {
    result.fullBytes = (result.fullBytes ?? 0) + stats.bytesTransferred
    result.fullFiles = (result.fullFiles ?? 0) + 1
  }
}

async function requestRemoteFullSend(
  relay: RelayClient,
  targetDeviceId: string,
  remoteRoot: string,
  relativePath: string,
  localTargetRoot: string,
  mode: 'auto' | 'delta' | 'full',
  signal?: AbortSignal,
): Promise<RemoteTransferStats> {
  throwIfAborted(signal)
  if (mode === 'delta') {
    throw new Error('Reverse bidirectional delta is not implemented; use transferMode=auto')
  }

  return await relay.request(targetDeviceId, 'delta:send-full', {
    root: remoteRoot,
    relativePath,
    targetRoot: localTargetRoot,
  }) as RemoteTransferStats
}

async function requestRemoteDeltaSend(
  relay: RelayClient,
  targetDeviceId: string,
  remoteRoot: string,
  relativePath: string,
  localEntry: FileEntry,
  localBackend: StorageBackend,
  localTargetRoot: string,
  mode: 'auto' | 'delta' | 'full',
  signal?: AbortSignal,
): Promise<RemoteTransferStats> {
  throwIfAborted(signal)
  if (mode === 'full') {
    return requestRemoteFullSend(relay, targetDeviceId, remoteRoot, relativePath, localTargetRoot, mode, signal)
  }

  const enginePath = resolveEnginePath()
  const localPath = localBackend.localPath?.(localEntry.absolutePath)
  if (!enginePath || !localPath) {
    if (mode === 'delta') throw new Error('Reverse delta requires Go engine and local-path-capable basis file')
    return requestRemoteFullSend(relay, targetDeviceId, remoteRoot, relativePath, localTargetRoot, mode, signal)
  }

  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sync-tool-reverse-signature-'))
  try {
    const signaturePath = await ensureSignature(enginePath, localPath, localEntry, workDir)
    const signature = JSON.parse(await fs.promises.readFile(signaturePath, 'utf8'))
    return await relay.request(targetDeviceId, 'delta:send-delta', {
      root: remoteRoot,
      relativePath,
      targetRoot: localTargetRoot,
      signature,
      mode,
    }) as RemoteTransferStats
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true })
  }
}

async function transferRemoteDelta(
  relay: RelayClient,
  targetDeviceId: string,
  sourceEntry: FileEntry,
  sourceBackend: StorageBackend,
  targetRoot: string,
  mode: 'auto' | 'delta' | 'full',
  signal?: AbortSignal,
): Promise<RemoteTransferStats> {
  throwIfAborted(signal)
  if (mode === 'full') {
    return transferRemoteFull(relay, targetDeviceId, sourceEntry, sourceBackend, targetRoot, signal)
  }

  const enginePath = resolveEnginePath()
  if (!enginePath) {
    if (mode === 'delta') throw new Error('sync engine binary is not available')
    return transferRemoteFull(relay, targetDeviceId, sourceEntry, sourceBackend, targetRoot, signal)
  }
  const sourceLocalPath = sourceBackend.localPath?.(sourceEntry.absolutePath)
  if (!sourceLocalPath) {
    if (mode === 'delta') throw new Error('source backend does not expose a local file path')
    return transferRemoteFull(relay, targetDeviceId, sourceEntry, sourceBackend, targetRoot, signal)
  }

  let signature: { signature: any }
  try {
    signature = await relay.request(targetDeviceId, 'delta:signature', {
      root: targetRoot,
      relativePath: sourceEntry.relativePath,
    }) as { signature: any }
  } catch (err) {
    if (mode === 'delta') throw err
    return transferRemoteFull(relay, targetDeviceId, sourceEntry, sourceBackend, targetRoot, signal)
  }

  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sync-tool-remote-delta-'))
  try {
    const signaturePath = path.join(workDir, 'target.sig.json')
    const deltaPath = path.join(workDir, 'source.delta.jsonl')
    await fs.promises.writeFile(signaturePath, JSON.stringify(signature.signature))
    await runEngine(enginePath, ['delta', '-source', sourceLocalPath, '-signature', signaturePath, '-out', deltaPath])

    const deltaSize = (await fs.promises.stat(deltaPath)).size
    if (deltaSize >= sourceEntry.size) {
      return transferRemoteFull(relay, targetDeviceId, sourceEntry, sourceBackend, targetRoot, signal)
    }

    const expectedSHA256 = await fileSHA256(sourceLocalPath)
    await uploadFileInChunks(relay, targetDeviceId, {
      kind:         'delta',
      filePath:     deltaPath,
      root:         targetRoot,
      relativePath: sourceEntry.relativePath,
      meta:         { size: sourceEntry.size, mtimeMs: sourceEntry.mtimeMs },
      expectedSHA256,
    }, signal)

    return { bytesTransferred: deltaSize, kind: 'delta', checksum: expectedSHA256 }
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true })
  }
}

async function transferRemoteFull(
  relay: RelayClient,
  targetDeviceId: string,
  sourceEntry: FileEntry,
  sourceBackend: StorageBackend,
  targetRoot: string,
  signal?: AbortSignal,
): Promise<RemoteTransferStats> {
  throwIfAborted(signal)
  const stream = await sourceBackend.read(sourceEntry.absolutePath)
  const checksum = await uploadStreamInChunks(relay, targetDeviceId, stream, {
    kind:         'full',
    root:         targetRoot,
    relativePath: sourceEntry.relativePath,
    meta:         { size: sourceEntry.size, mtimeMs: sourceEntry.mtimeMs },
  }, signal)

  return { bytesTransferred: sourceEntry.size, kind: 'full', checksum }
}

async function uploadFileInChunks(
  relay: RelayClient,
  targetDeviceId: string,
  input: {
    kind: 'delta' | 'full'
    filePath: string
    root: string
    relativePath: string
    meta: { size: number; mtimeMs: number }
    expectedSHA256?: string
  },
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal)

  // Deterministic ID: same file + same target → same ID across reconnects, enabling resume.
  const proposedId = crypto.createHash('sha256')
    .update(`${targetDeviceId}:${input.root}:${input.relativePath}:${input.meta.size}:${input.meta.mtimeMs}`)
    .digest('hex')
    .slice(0, 32)

  const { transferId, resumeFromSeq } = await relay.request(targetDeviceId, 'delta:transfer-start', {
    kind:         input.kind,
    root:         input.root,
    relativePath: input.relativePath,
    meta:         input.meta,
    proposedId,
  }) as { transferId: string; resumeFromSeq: number }

  const startByte = resumeFromSeq * RELAY_CHUNK_BYTES
  let seq = resumeFromSeq
  if (resumeFromSeq > 0) {
    console.log(`[transfer] Resuming upload of ${input.relativePath} from byte ${startByte} (chunk ${resumeFromSeq})`)
  }

  try {
    const readOpts: Parameters<typeof fs.createReadStream>[1] = { highWaterMark: RELAY_CHUNK_BYTES }
    if (startByte > 0) readOpts.start = startByte
    for await (const chunk of fs.createReadStream(input.filePath, readOpts)) {
      throwIfAborted(signal)
      await relay.event(targetDeviceId, 'delta:transfer-chunk', {
        transferId,
        seq,
        dataBase64: (chunk as Buffer).toString('base64'),
      })
      seq++
    }
    await relay.request(targetDeviceId, 'delta:transfer-finish', {
      transferId,
      expectedSHA256: input.expectedSHA256 ?? await fileSHA256(input.filePath),
    })
  } catch (err) {
    try {
      await relay.request(targetDeviceId, 'delta:transfer-abort', { transferId })
    } catch {
      // Ignore abort failures; the original error is more useful.
    }
    throw err
  }
}

async function uploadStreamInChunks(
  relay: RelayClient,
  targetDeviceId: string,
  stream: NodeJS.ReadableStream,
  input: {
    kind: 'delta' | 'full'
    root: string
    relativePath: string
    meta: { size: number; mtimeMs: number }
  },
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal)
  const { transferId } = await relay.request(targetDeviceId, 'delta:transfer-start', {
    kind:         input.kind,
    root:         input.root,
    relativePath: input.relativePath,
    meta:         input.meta,
  }) as { transferId: string }

  let seq = 0
  const hash = crypto.createHash('sha256')
  try {
    for await (const chunk of stream as any as AsyncIterable<Buffer | string>) {
      throwIfAborted(signal)
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      for (let offset = 0; offset < buffer.length; offset += RELAY_CHUNK_BYTES) {
        throwIfAborted(signal)
        const part = buffer.subarray(offset, offset + RELAY_CHUNK_BYTES)
        hash.update(part)
        await relay.event(targetDeviceId, 'delta:transfer-chunk', {
          transferId,
          seq,
          dataBase64: part.toString('base64'),
        })
        seq++
      }
    }
    const expectedSHA256 = hash.digest('hex')
    await relay.request(targetDeviceId, 'delta:transfer-finish', {
      transferId,
      expectedSHA256,
    })
    return expectedSHA256
  } catch (err) {
    try {
      await relay.request(targetDeviceId, 'delta:transfer-abort', { transferId })
    } catch {
      // Ignore abort failures; the original error is more useful.
    }
    throw err
  }
}

// Manifest page size chosen to stay well under the 3 MB relay message limit (~40 KB/page).
const MANIFEST_PAGE_SIZE  = 500
const MANIFEST_CACHE_TTL  = 60_000

interface ManifestCacheEntry {
  entries:   RemoteManifestEntry[]
  expiresAt: number
}
const manifestCache = new Map<string, ManifestCacheEntry>()

async function handleManifest(
  root:    string,
  cursor?: number,
): Promise<{ entries: RemoteManifestEntry[]; nextCursor?: number; total: number }> {
  await assertAllowedLocalEndpoint(root)

  let cached = manifestCache.get(root)
  if (!cached || Date.now() > cached.expiresAt) {
    const target = resolveBackend(root)
    try {
      await target.backend.mkdirp(target.rootPath)
      const files   = await target.backend.walk(target.rootPath)
      const entries = [...files.values()]
        .filter((e) => !e.isDirectory)
        .map((e) => ({ relativePath: e.relativePath, absolutePath: e.absolutePath, size: e.size, mtimeMs: e.mtimeMs }))
      cached = { entries, expiresAt: Date.now() + MANIFEST_CACHE_TTL }
      manifestCache.set(root, cached)
    } finally {
      await target.backend.close?.()
    }
  }

  const offset     = cursor ?? 0
  const page       = cached.entries.slice(offset, offset + MANIFEST_PAGE_SIZE)
  const nextCursor = offset + MANIFEST_PAGE_SIZE < cached.entries.length ? offset + MANIFEST_PAGE_SIZE : undefined
  return { entries: page, nextCursor, total: cached.entries.length }
}

async function handleSignature(root: string, relativePath: string): Promise<{ signature: any }> {
  const enginePath = resolveEnginePath()
  if (!enginePath) throw new Error('sync engine binary is not available')
  assertSafeRelativePath(relativePath)
  await assertAllowedLocalEndpoint(root)

  const target = resolveBackend(root)
  const targetPath = joinRemote(target.rootPath, relativePath)
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sync-tool-signature-'))
  try {
    await target.backend.mkdirp(target.rootPath)
    const localPath = target.backend.localPath?.(targetPath)
    if (!localPath) throw new Error('target backend does not expose a local file path')

    const stat = await fs.promises.stat(localPath)
    const signaturePath = await ensureSignature(enginePath, localPath, {
      relativePath,
      absolutePath: targetPath,
      size:         stat.size,
      mtimeMs:      stat.mtimeMs,
      isDirectory:  false,
    }, workDir)
    return { signature: JSON.parse(await fs.promises.readFile(signaturePath, 'utf8')) }
  } finally {
    await target.backend.close?.()
    await fs.promises.rm(workDir, { recursive: true, force: true })
  }
}

async function handleSendFull(
  relay: RelayClient,
  requesterDeviceId: string,
  root: string,
  relativePath: string,
  targetRoot: string,
): Promise<RemoteTransferStats> {
  assertSafeRelativePath(relativePath)
  await Promise.all([
    assertAllowedLocalEndpoint(root),
    assertAllowedLocalEndpoint(targetRoot),
  ])
  const source = resolveBackend(root)
  try {
    const files = await source.backend.walk(source.rootPath)
    const entry = files.get(relativePath)
    if (!entry || entry.isDirectory) throw new Error(`File not found: ${relativePath}`)

    const stream = await source.backend.read(entry.absolutePath)
    const checksum = await uploadStreamInChunks(relay, requesterDeviceId, stream, {
      kind:         'full',
      root:         targetRoot,
      relativePath,
      meta:         { size: entry.size, mtimeMs: entry.mtimeMs },
    })

    return { bytesTransferred: entry.size, kind: 'full', checksum }
  } finally {
    await source.backend.close?.()
  }
}

async function handleSendDelta(
  relay: RelayClient,
  requesterDeviceId: string,
  root: string,
  relativePath: string,
  targetRoot: string,
  signature: any,
  mode: 'auto' | 'delta' | 'full',
): Promise<RemoteTransferStats> {
  assertSafeRelativePath(relativePath)
  if (mode === 'full') {
    return handleSendFull(relay, requesterDeviceId, root, relativePath, targetRoot)
  }

  const enginePath = resolveEnginePath()
  if (!enginePath) {
    if (mode === 'delta') throw new Error('sync engine binary is not available')
    return handleSendFull(relay, requesterDeviceId, root, relativePath, targetRoot)
  }

  await Promise.all([
    assertAllowedLocalEndpoint(root),
    assertAllowedLocalEndpoint(targetRoot),
  ])
  const source = resolveBackend(root)
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sync-tool-send-delta-'))
  try {
    const files = await source.backend.walk(source.rootPath)
    const entry = files.get(relativePath)
    if (!entry || entry.isDirectory) throw new Error(`File not found: ${relativePath}`)

    const localPath = source.backend.localPath?.(entry.absolutePath)
    if (!localPath) {
      if (mode === 'delta') throw new Error('source backend does not expose a local file path')
      return handleSendFull(relay, requesterDeviceId, root, relativePath, targetRoot)
    }

    const signaturePath = path.join(workDir, 'basis.sig.json')
    const deltaPath = path.join(workDir, 'reverse.delta.jsonl')
    await fs.promises.writeFile(signaturePath, JSON.stringify(signature))
    await runEngine(enginePath, ['delta', '-source', localPath, '-signature', signaturePath, '-out', deltaPath])

    const deltaSize = (await fs.promises.stat(deltaPath)).size
    if (mode === 'auto' && deltaSize >= entry.size) {
      return handleSendFull(relay, requesterDeviceId, root, relativePath, targetRoot)
    }

    const expectedSHA256 = await fileSHA256(localPath)
    await uploadFileInChunks(relay, requesterDeviceId, {
      kind:         'delta',
      filePath:     deltaPath,
      root:         targetRoot,
      relativePath,
      meta:         { size: entry.size, mtimeMs: entry.mtimeMs },
      expectedSHA256,
    })

    return { bytesTransferred: deltaSize, kind: 'delta', checksum: expectedSHA256 }
  } finally {
    await source.backend.close?.()
    await fs.promises.rm(workDir, { recursive: true, force: true })
  }
}

async function handleDelete(root: string, relativePath: string) {
  assertSafeRelativePath(relativePath)
  await assertAllowedLocalEndpoint(root)
  const target = resolveBackend(root)
  try {
    if (!target.backend.delete) throw new Error('target backend does not support delete')
    await target.backend.delete(joinRemote(target.rootPath, relativePath))
    return { ok: true }
  } finally {
    await target.backend.close?.()
  }
}

async function handleMove(
  root: string,
  fromRelativePath: string,
  toRelativePath: string,
  meta: { size: number; mtimeMs: number },
) {
  assertSafeRelativePath(fromRelativePath)
  assertSafeRelativePath(toRelativePath)
  await assertAllowedLocalEndpoint(root)
  const target = resolveBackend(root)
  try {
    if (!target.backend.move) throw new Error('target backend does not support move')
    await target.backend.move(
      joinRemote(target.rootPath, fromRelativePath),
      joinRemote(target.rootPath, toRelativePath),
      meta,
    )
    return { ok: true }
  } finally {
    await target.backend.close?.()
  }
}

async function handleTransferStart(
  kind: 'delta' | 'full',
  root: string,
  relativePath: string,
  meta: { size: number; mtimeMs: number },
  proposedId?: string,
) {
  if (kind !== 'delta' && kind !== 'full') throw new Error(`Unsupported transfer kind: ${kind}`)
  assertSafeRelativePath(relativePath)
  await assertAllowedLocalEndpoint(root)

  // If the initiator proposes a deterministic ID, check for a resumable session.
  if (proposedId) {
    const existing = transferSessions.get(proposedId)
    if (existing && existing.kind === kind && existing.relativePath === relativePath && !existing.writeError) {
      existing.updatedAt = Date.now()
      console.log(`[transfer] Resuming ${relativePath} from chunk ${existing.nextSeq}`)
      return { transferId: proposedId, resumeFromSeq: existing.nextSeq }
    }
  }

  const transferId = proposedId ?? crypto.randomUUID()
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sync-tool-transfer-'))
  const tempPath = path.join(tempDir, `${transferId}.payload`)
  transferSessions.set(transferId, {
    id: transferId,
    kind,
    root,
    relativePath,
    meta,
    tempPath,
    nextSeq: 0,
    updatedAt: Date.now(),
    writeChain: Promise.resolve(),
  })
  return { transferId, resumeFromSeq: 0 }
}

async function handleTransferChunk(transferId: string, seq: number, dataBase64: string) {
  const session = transferSessions.get(transferId)
  if (!session) throw new Error(`Unknown transfer: ${transferId}`)

  const write = session.writeChain.then(async () => {
    if (seq !== session.nextSeq) throw new Error(`Unexpected transfer chunk sequence: got ${seq}, expected ${session.nextSeq}`)
    await fs.promises.appendFile(session.tempPath, Buffer.from(dataBase64, 'base64'))
    session.nextSeq++
    session.updatedAt = Date.now()
  })
  session.writeChain = write.catch((err) => {
    session.writeError = err
  })
  await write
  return { ok: true }
}

async function handleTransferFinish(transferId: string, expectedSHA256?: string) {
  const session = transferSessions.get(transferId)
  if (!session) throw new Error(`Unknown transfer: ${transferId}`)
  session.expectedSHA256 = expectedSHA256

  try {
    await session.writeChain
    if (session.writeError) throw session.writeError
    if (session.kind === 'delta') {
      await applyDeltaPayload(session)
    } else {
      await writeFullPayload(session)
    }
    return { ok: true }
  } finally {
    transferSessions.delete(transferId)
    await fs.promises.rm(path.dirname(session.tempPath), { recursive: true, force: true })
  }
}

async function handleTransferAbort(transferId: string) {
  const session = transferSessions.get(transferId)
  if (!session) return { ok: true }
  transferSessions.delete(transferId)
  await fs.promises.rm(path.dirname(session.tempPath), { recursive: true, force: true })
  return { ok: true }
}

function startTransferSessionSweeper() {
  if (transferSessionSweeperStarted) return
  transferSessionSweeperStarted = true

  setInterval(() => {
    const cutoff = Date.now() - TRANSFER_SESSION_TTL_MS
    for (const [transferId, session] of transferSessions) {
      if (session.updatedAt >= cutoff) continue
      transferSessions.delete(transferId)
      void fs.promises.rm(path.dirname(session.tempPath), { recursive: true, force: true })
    }
  }, TRANSFER_SESSION_SWEEP_MS).unref()
}

async function applyDeltaPayload(session: TransferSession) {
  const enginePath = resolveEnginePath()
  if (!enginePath) throw new Error('sync engine binary is not available')
  assertSafeRelativePath(session.relativePath)
  await assertAllowedLocalEndpoint(session.root)

  const target = resolveBackend(session.root)
  const targetPath = joinRemote(target.rootPath, session.relativePath)
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sync-tool-apply-'))
  try {
    await target.backend.mkdirp(target.rootPath)
    const localPath = target.backend.localPath?.(targetPath)
    if (!localPath) throw new Error('target backend does not expose a local file path')

    const deltaPath = path.join(workDir, 'delta.jsonl')
    await fs.promises.copyFile(session.tempPath, deltaPath)
    const args = ['apply', '-basis', localPath, '-delta', deltaPath, '-out', localPath]
    if (session.expectedSHA256) args.push('-expect-sha256', session.expectedSHA256)
    await runEngine(enginePath, args)
    const mtime = new Date(session.meta.mtimeMs)
    await fs.promises.utimes(localPath, mtime, mtime)
    if (session.expectedSHA256) {
      await assertTargetHash(target, targetPath, session.expectedSHA256)
    }
  } finally {
    await target.backend.close?.()
    await fs.promises.rm(workDir, { recursive: true, force: true })
  }
}

async function writeFullPayload(session: TransferSession) {
  assertSafeRelativePath(session.relativePath)
  await assertAllowedLocalEndpoint(session.root)
  const target = resolveBackend(session.root)
  const targetPath = joinRemote(target.rootPath, session.relativePath)
  try {
    await target.backend.write(targetPath, fs.createReadStream(session.tempPath), session.meta, { atomic: true })
    if (session.expectedSHA256) {
      await assertTargetHash(target, targetPath, session.expectedSHA256)
    }
  } finally {
    await target.backend.close?.()
  }
}

function assertSafeRelativePath(relativePath: string): void {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error(`Invalid relative path: ${relativePath}`)
  const normalized = path.normalize(relativePath)
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw new Error(`Invalid relative path: ${relativePath}`)
}

async function assertTargetHash(
  target: ReturnType<typeof resolveBackend>,
  targetPath: string,
  expectedSHA256: string,
) {
  const localPath = target.backend.localPath?.(targetPath)
  const actualSHA256 = localPath
    ? await fileSHA256(localPath)
    : await streamSHA256(await target.backend.read(targetPath))

  if (actualSHA256 !== expectedSHA256) {
    throw new Error(`target SHA-256 mismatch: got ${actualSHA256}, expected ${expectedSHA256}`)
  }
}

function initiatingDeviceId(job: Job): string | undefined {
  if (!job.sourceDeviceId || !job.destinationDeviceId) return undefined
  if (job.direction === 'rtl') return job.destinationDeviceId
  return job.sourceDeviceId
}
