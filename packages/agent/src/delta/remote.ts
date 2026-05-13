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
    errors:           [],
  }

  if (job.direction === 'bidir') {
    return runRemoteBidirectionalSync(job, relay, state, result, onProgress, signal)
  }

  const sourceLocation = job.direction === 'rtl' ? job.destination : job.source
  const targetLocation = job.direction === 'rtl' ? job.source : job.destination
  const targetDeviceId = job.direction === 'rtl' ? job.sourceDeviceId! : job.destinationDeviceId!
  const source = resolveBackend(sourceLocation)
  try {
    throwIfAborted(signal)
    await source.backend.mkdirp(source.rootPath)
    const [sourceFiles, targetEntries] = await Promise.all([
      source.backend.walk(source.rootPath),
      relay.request(targetDeviceId, 'delta:manifest', { root: targetLocation }) as Promise<RemoteManifestEntry[]>,
    ])

    const targetFiles = new Map(targetEntries.map((entry) => [entry.relativePath, entry]))
    const entries = [...sourceFiles.values()].filter((entry) => !entry.isDirectory)
    let processed = 0

    for (const sourceEntry of entries) {
      throwIfAborted(signal)
      const targetEntry = targetFiles.get(sourceEntry.relativePath)
      const needsCopy = !targetEntry
        || targetEntry.size !== sourceEntry.size
        || (!mtimeEqual(sourceEntry.mtimeMs, targetEntry.mtimeMs) && sourceEntry.mtimeMs > targetEntry.mtimeMs)

      if (needsCopy) {
        try {
          const transferred = targetEntry
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

      processed++
      onProgress({
        jobId:            job.id,
        currentFile:      sourceEntry.relativePath,
        filesProcessed:   processed,
        filesTotal:       entries.length,
        bytesTransferred: result.bytesTransferred,
      })
    }
  } finally {
    result.endedAt = Date.now()
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
    throwIfAborted(signal)
    await source.backend.mkdirp(source.rootPath)
    const [sourceFiles, targetEntries] = await Promise.all([
      source.backend.walk(source.rootPath),
      relay.request(destinationDeviceId, 'delta:manifest', { root: job.destination }) as Promise<RemoteManifestEntry[]>,
    ])

    const targetFiles   = new Map(targetEntries.map((entry) => [entry.relativePath, entry]))
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
            // Remote delete requires a relay protocol extension — log for now (Phase 3)
            console.log(`[remote] Would delete from dst (remote delete not yet implemented): ${rel}`)
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
    await source.backend.close?.()
  }

  return result
}

export function registerRemoteDeltaHandlers(relay: RelayClient) {
  startTransferSessionSweeper()
  relay.onRequest(async (from, method, body) => {
    switch (method) {
      case 'delta:manifest':
        return handleManifest(body.root)
      case 'delta:signature':
        return handleSignature(body.root, body.relativePath)
      case 'delta:transfer-start':
        return handleTransferStart(body.kind, body.root, body.relativePath, body.meta)
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
      default:
        throw new Error(`Unsupported relay method: ${method}`)
    }
  })
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

async function detectRemoteSideMoves(input: RemoteSideMoveInput): Promise<Map<string, string>> {
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
  const { transferId } = await relay.request(targetDeviceId, 'delta:transfer-start', {
    kind:         input.kind,
    root:         input.root,
    relativePath: input.relativePath,
    meta:         input.meta,
  }) as { transferId: string }

  let seq = 0
  try {
    for await (const chunk of fs.createReadStream(input.filePath, { highWaterMark: RELAY_CHUNK_BYTES })) {
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

async function handleManifest(root: string): Promise<RemoteManifestEntry[]> {
  const target = resolveBackend(root)
  try {
    await target.backend.mkdirp(target.rootPath)
    const files = await target.backend.walk(target.rootPath)
    return [...files.values()]
      .filter((entry) => !entry.isDirectory)
      .map((entry) => ({
        relativePath: entry.relativePath,
        absolutePath: entry.absolutePath,
        size:         entry.size,
        mtimeMs:      entry.mtimeMs,
      }))
  } finally {
    await target.backend.close?.()
  }
}

async function handleSignature(root: string, relativePath: string): Promise<{ signature: any }> {
  const enginePath = resolveEnginePath()
  if (!enginePath) throw new Error('sync engine binary is not available')

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
  if (mode === 'full') {
    return handleSendFull(relay, requesterDeviceId, root, relativePath, targetRoot)
  }

  const enginePath = resolveEnginePath()
  if (!enginePath) {
    if (mode === 'delta') throw new Error('sync engine binary is not available')
    return handleSendFull(relay, requesterDeviceId, root, relativePath, targetRoot)
  }

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

async function handleMove(
  root: string,
  fromRelativePath: string,
  toRelativePath: string,
  meta: { size: number; mtimeMs: number },
) {
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
) {
  if (kind !== 'delta' && kind !== 'full') throw new Error(`Unsupported transfer kind: ${kind}`)
  const transferId = crypto.randomUUID()
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
  return { transferId }
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
  const target = resolveBackend(session.root)
  const targetPath = joinRemote(target.rootPath, session.relativePath)
  try {
    await target.backend.write(targetPath, fs.createReadStream(session.tempPath), session.meta)
    if (session.expectedSHA256) {
      await assertTargetHash(target, targetPath, session.expectedSHA256)
    }
  } finally {
    await target.backend.close?.()
  }
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
