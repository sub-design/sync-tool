import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import type { FileEntry, StorageBackend } from '../sync'

const DEFAULT_BLOCK_SIZE = 64 * 1024
const ENGINE_VERSION = 'delta-v1'

export interface DeltaTransferInput {
  srcEntry:   FileEntry
  srcBackend: StorageBackend
  dstEntry:   FileEntry
  dstBackend: StorageBackend
  dstPath:    string
  mode:       'delta' | 'auto'
}

export interface DeltaTransferResult {
  applied:          boolean
  bytesTransferred: number
  checksum?:        string
  reason?:          string
}

export async function transferFileDelta(input: DeltaTransferInput): Promise<DeltaTransferResult> {
  const enginePath = resolveEnginePath()
  if (!enginePath) {
    return { applied: false, bytesTransferred: 0, reason: 'sync engine binary is not available' }
  }

  const srcLocalPath = input.srcBackend.localPath?.(input.srcEntry.absolutePath)
  const dstLocalPath = input.dstBackend.localPath?.(input.dstEntry.absolutePath)
  if (!srcLocalPath || !dstLocalPath) {
    return { applied: false, bytesTransferred: 0, reason: 'backend pair does not expose local file paths' }
  }

  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sync-tool-delta-'))
  try {
    const signaturePath = await ensureSignature(enginePath, dstLocalPath, input.dstEntry, workDir)
    const deltaPath = path.join(workDir, 'delta.jsonl')

    await runEngine(enginePath, [
      'delta',
      '-source', srcLocalPath,
      '-signature', signaturePath,
      '-out', deltaPath,
    ])

    const deltaSize = (await fs.promises.stat(deltaPath)).size
    if (input.mode === 'auto' && deltaSize >= input.srcEntry.size) {
      return { applied: false, bytesTransferred: 0, reason: 'delta is not smaller than full file' }
    }

    const expectedSHA256 = await fileSHA256(srcLocalPath)
    await runEngine(enginePath, [
      'apply',
      '-basis', dstLocalPath,
      '-delta', deltaPath,
      '-out', dstLocalPath,
      '-expect-sha256', expectedSHA256,
    ])

    const mtime = new Date(input.srcEntry.mtimeMs)
    await fs.promises.utimes(dstLocalPath, mtime, mtime)
    await removeStaleSignature(input.dstEntry)
    await ensureSignature(enginePath, dstLocalPath, {
      ...input.dstEntry,
      size:    input.srcEntry.size,
      mtimeMs: input.srcEntry.mtimeMs,
    }, workDir)

    return { applied: true, bytesTransferred: deltaSize, checksum: expectedSHA256 }
  } catch (err: any) {
    if (input.mode === 'delta') throw err
    return { applied: false, bytesTransferred: 0, reason: err.message }
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true })
  }
}

export async function ensureSignature(
  enginePath: string,
  filePath: string,
  entry: FileEntry,
  workDir: string,
): Promise<string> {
  const cachedPath = signatureCachePath(entry)
  if (await exists(cachedPath)) return cachedPath

  const tempSignature = path.join(workDir, `${path.basename(cachedPath)}.tmp`)
  await runEngine(enginePath, [
    'signature',
    '-file', filePath,
    '-out', tempSignature,
    '-block-size', String(DEFAULT_BLOCK_SIZE),
  ])

  await fs.promises.mkdir(path.dirname(cachedPath), { recursive: true })
  await fs.promises.copyFile(tempSignature, cachedPath)
  return cachedPath
}

async function removeStaleSignature(entry: FileEntry): Promise<void> {
  await fs.promises.rm(signatureCachePath(entry), { force: true })
}

function signatureCachePath(entry: FileEntry): string {
  const cacheDir = process.env.SYNC_SIGNATURE_CACHE_DIR
    ?? path.join(os.homedir(), '.sync-tool', 'signatures')
  const key = crypto.createHash('sha256').update(JSON.stringify({
    version:   ENGINE_VERSION,
    blockSize: DEFAULT_BLOCK_SIZE,
    path:      entry.absolutePath,
    size:      entry.size,
    mtimeMs:   Math.round(entry.mtimeMs),
  })).digest('hex')

  return path.join(cacheDir, `${key}.sig.json`)
}

export function resolveEnginePath(): string | undefined {
  const candidates = [
    process.env.SYNC_ENGINE_PATH,
    path.resolve(__dirname, '../../../sync-engine-go/bin/sync-engine'),
    path.resolve(__dirname, '../../../sync-engine-go/bin/sync-engine.exe'),
  ].filter(Boolean) as string[]

  return candidates.find((candidate) => fs.existsSync(candidate))
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}

export async function runEngine(enginePath: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(enginePath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''

    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`sync-engine ${args[0]} exited with ${code}: ${stderr.trim()}`))
      }
    })
  })
}

export async function fileSHA256(filePath: string): Promise<string> {
  return streamSHA256(fs.createReadStream(filePath))
}

export async function streamSHA256(stream: NodeJS.ReadableStream): Promise<string> {
  const hash = crypto.createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}
