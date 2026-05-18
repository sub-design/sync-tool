import chokidar, { type FSWatcher } from 'chokidar'
import fs from 'fs'
import path from 'path'
import type { Job } from '@sync-tool/shared'
import { resolvePathVariables, resolveUserPath } from './pathVariables'

type TriggerJob = (jobId: string, changedPath?: string) => void

const DEFAULT_WATCH_DEBOUNCE_MS = 1_500
const DEFAULT_WATCH_STORM_EVENT_THRESHOLD = 1_000
const DEFAULT_FOLDER_CONNECT_POLL_MS = 5_000
const DEFAULT_FOLDER_CONNECT_DEBOUNCE_MS = 1_000

export class JobWatcher {
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly eventCounts = new Map<string, number>()
  private readonly lastChangedPaths = new Map<string, string | undefined>()

  constructor(
    private readonly deviceId: string,
    private readonly triggerJob: TriggerJob,
    private readonly debounceMs = Math.max(100, parseInt(process.env.WATCH_DEBOUNCE_MS ?? String(DEFAULT_WATCH_DEBOUNCE_MS), 10)),
    private readonly stormEventThreshold = parsePositiveInt(process.env.WATCH_STORM_EVENT_THRESHOLD, DEFAULT_WATCH_STORM_EVENT_THRESHOLD),
  ) {}

  sync(jobs: Job[]): void {
    const wanted = new Map<string, { job: Job; paths: string[] }>()
    for (const job of jobs) {
      const paths = watchPathsForJob(job, this.deviceId)
      if (paths.length > 0) wanted.set(job.id, { job, paths })
    }

    for (const [jobId, watcher] of this.watchers) {
      if (wanted.has(jobId)) continue
      void watcher.close()
      this.watchers.delete(jobId)
      this.clearTimer(jobId)
      this.eventCounts.delete(jobId)
      this.lastChangedPaths.delete(jobId)
    }

    for (const { job, paths } of wanted.values()) {
      if (this.watchers.has(job.id)) continue
      this.watchers.set(job.id, this.createWatcher(job, paths))
    }
  }

  close(): void {
    for (const watcher of this.watchers.values()) void watcher.close()
    this.watchers.clear()
    for (const jobId of this.timers.keys()) {
      this.clearTimer(jobId)
      this.eventCounts.delete(jobId)
      this.lastChangedPaths.delete(jobId)
    }
  }

  private createWatcher(job: Job, paths: string[]): FSWatcher {
    const watcher = chokidar.watch(paths, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1_000,
        pollInterval: 100,
      },
      ignored: (candidatePath) => shouldIgnoreWatchPath(candidatePath),
    })

    watcher.on('all', (_event, changedPath) => {
      this.scheduleTrigger(job, changedPath)
    })
    watcher.on('error', (err) => {
      console.warn(`[watch] Job ${job.id} watcher error: ${err instanceof Error ? err.message : String(err)}`)
    })

    console.log(`[watch] Watching job "${job.name}" (${job.id}): ${paths.join(', ')}`)
    return watcher
  }

  scheduleTrigger(job: Job | string, changedPath?: string): void {
    const jobId = typeof job === 'string' ? job : job.id
    const count = (this.eventCounts.get(jobId) ?? 0) + 1
    this.eventCounts.set(jobId, count)
    this.lastChangedPaths.set(jobId, changedPath)
    this.clearTimer(jobId)
    const timer = setTimeout(() => {
      this.timers.delete(jobId)
      const eventCount = this.eventCounts.get(jobId) ?? 0
      const pathToReport = eventCount > this.stormEventThreshold
        ? undefined
        : this.lastChangedPaths.get(jobId)
      this.eventCounts.delete(jobId)
      this.lastChangedPaths.delete(jobId)
      if (eventCount > this.stormEventThreshold) {
        console.warn(`[watch] Job ${jobId} received ${eventCount} filesystem events; running full scan`)
      }
      this.triggerJob(jobId, pathToReport)
    }, typeof job === 'string' ? this.debounceMs : this.debounceMsFor(job))
    timer.unref()
    this.timers.set(jobId, timer)
  }

  private clearTimer(jobId: string): void {
    const timer = this.timers.get(jobId)
    if (timer) clearTimeout(timer)
    this.timers.delete(jobId)
  }

  private debounceMsFor(job: Job): number {
    const delaySec = job.autoOptions?.fileChangeDelaySec
    if (delaySec == null) return this.debounceMs
    return Math.max(100, delaySec * 1000)
  }
}

type IsPathAvailable = (path: string) => Promise<boolean>

export class FolderConnectMonitor {
  private readonly jobs = new Map<string, { job: Job; paths: string[] }>()
  private readonly availability = new Map<string, boolean>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private interval?: NodeJS.Timeout
  private polling = false

  constructor(
    private readonly deviceId: string,
    private readonly triggerJob: TriggerJob,
    private readonly pollMs = Math.max(1_000, parseInt(process.env.FOLDER_CONNECT_POLL_MS ?? String(DEFAULT_FOLDER_CONNECT_POLL_MS), 10)),
    private readonly debounceMs = Math.max(100, parseInt(process.env.FOLDER_CONNECT_DEBOUNCE_MS ?? String(DEFAULT_FOLDER_CONNECT_DEBOUNCE_MS), 10)),
    private readonly isPathAvailable: IsPathAvailable = defaultIsPathAvailable,
  ) {}

  sync(jobs: Job[]): void {
    const wanted = new Map<string, { job: Job; paths: string[] }>()
    for (const job of jobs) {
      const paths = folderConnectPathsForJob(job, this.deviceId)
      if (paths.length > 0) wanted.set(job.id, { job, paths })
    }

    for (const jobId of this.jobs.keys()) {
      if (wanted.has(jobId)) continue
      this.jobs.delete(jobId)
      this.clearTimer(jobId)
      for (const key of this.availability.keys()) {
        if (key.startsWith(`${jobId}\0`)) this.availability.delete(key)
      }
    }

    for (const [jobId, entry] of wanted) {
      this.jobs.set(jobId, entry)
    }

    if (this.jobs.size > 0 && !this.interval) {
      this.interval = setInterval(() => {
        void this.pollNow()
      }, this.pollMs)
      this.interval.unref()
      void this.pollNow()
    } else if (this.jobs.size === 0 && this.interval) {
      clearInterval(this.interval)
      this.interval = undefined
    }
  }

  async pollNow(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      for (const [jobId, { paths }] of this.jobs) {
        let becameAvailable = false
        for (const candidate of paths) {
          const key = availabilityKey(jobId, candidate)
          const wasAvailable = this.availability.get(key)
          const available = await this.isPathAvailable(candidate)
          this.availability.set(key, available)
          if (wasAvailable === false && available) becameAvailable = true
        }
        if (becameAvailable) this.scheduleTrigger(jobId)
      }
    } finally {
      this.polling = false
    }
  }

  close(): void {
    if (this.interval) clearInterval(this.interval)
    this.interval = undefined
    this.jobs.clear()
    this.availability.clear()
    for (const jobId of this.timers.keys()) this.clearTimer(jobId)
  }

  private scheduleTrigger(jobId: string): void {
    this.clearTimer(jobId)
    const timer = setTimeout(() => {
      this.timers.delete(jobId)
      console.log(`[folder-connect] Folder became available for job ${jobId}`)
      this.triggerJob(jobId)
    }, this.debounceMs)
    timer.unref()
    this.timers.set(jobId, timer)
  }

  private clearTimer(jobId: string): void {
    const timer = this.timers.get(jobId)
    if (timer) clearTimeout(timer)
    this.timers.delete(jobId)
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function watchPathsForJob(job: Job, deviceId: string): string[] {
  if (!job.watch) return []
  return localPathsForJob(job, deviceId)
}

export function folderConnectPathsForJob(job: Job, deviceId: string): string[] {
  if (!job.autoOptions?.onFolderConnect) return []
  return localPathsForJob(job, deviceId)
}

function localPathsForJob(job: Job, deviceId: string): string[] {
  const candidates: string[] = []
  if (job.direction === 'ltr' || job.direction === 'bidir') {
    if (!job.sourceDeviceId || job.sourceDeviceId === deviceId) candidates.push(job.source)
  }
  if (job.direction === 'rtl' || job.direction === 'bidir') {
    if (!job.destinationDeviceId || job.destinationDeviceId === deviceId) candidates.push(job.destination)
  }

  return [...new Set(candidates.map(resolveWatchPath).filter(isWatchableLocalPath))]
}

function isWatchableLocalPath(value: string): boolean {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return false
  return path.isAbsolute(value)
}

function resolveWatchPath(value: string): string {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(resolvePathVariables(value))) return value
  return resolveUserPath(value)
}

export function shouldIgnoreWatchPath(candidatePath: string): boolean {
  const normalized = candidatePath.split(path.sep).join('/')
  return normalized.includes('/_syncdata_/')
    || normalized.endsWith('.sync-tool-part')
    || normalized.includes('.sync-tool-part.')
}

async function defaultIsPathAvailable(candidatePath: string): Promise<boolean> {
  try {
    await fs.promises.access(candidatePath, fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}

function availabilityKey(jobId: string, candidatePath: string): string {
  return `${jobId}\0${candidatePath}`
}
