import chokidar, { type FSWatcher } from 'chokidar'
import path from 'path'
import type { Job } from '@sync-tool/shared'

type TriggerJob = (jobId: string, changedPath?: string) => void

const DEFAULT_WATCH_DEBOUNCE_MS = 1_500

export class JobWatcher {
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly timers = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly deviceId: string,
    private readonly triggerJob: TriggerJob,
    private readonly debounceMs = Math.max(100, parseInt(process.env.WATCH_DEBOUNCE_MS ?? String(DEFAULT_WATCH_DEBOUNCE_MS), 10)),
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
    }

    for (const { job, paths } of wanted.values()) {
      if (this.watchers.has(job.id)) continue
      this.watchers.set(job.id, this.createWatcher(job, paths))
    }
  }

  close(): void {
    for (const watcher of this.watchers.values()) void watcher.close()
    this.watchers.clear()
    for (const jobId of this.timers.keys()) this.clearTimer(jobId)
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
      this.scheduleTrigger(job.id, changedPath)
    })
    watcher.on('error', (err) => {
      console.warn(`[watch] Job ${job.id} watcher error: ${err instanceof Error ? err.message : String(err)}`)
    })

    console.log(`[watch] Watching job "${job.name}" (${job.id}): ${paths.join(', ')}`)
    return watcher
  }

  private scheduleTrigger(jobId: string, changedPath?: string): void {
    this.clearTimer(jobId)
    const timer = setTimeout(() => {
      this.timers.delete(jobId)
      this.triggerJob(jobId, changedPath)
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

export function watchPathsForJob(job: Job, deviceId: string): string[] {
  if (!job.watch) return []

  const candidates: string[] = []
  if (job.direction === 'ltr' || job.direction === 'bidir') {
    if (!job.sourceDeviceId || job.sourceDeviceId === deviceId) candidates.push(job.source)
  }
  if (job.direction === 'rtl' || job.direction === 'bidir') {
    if (!job.destinationDeviceId || job.destinationDeviceId === deviceId) candidates.push(job.destination)
  }

  return [...new Set(candidates.filter(isWatchableLocalPath))]
}

function isWatchableLocalPath(value: string): boolean {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return false
  return path.isAbsolute(value)
}

export function shouldIgnoreWatchPath(candidatePath: string): boolean {
  const normalized = candidatePath.split(path.sep).join('/')
  return normalized.includes('/_syncdata_/')
    || normalized.endsWith('.sync-tool-part')
    || normalized.includes('.sync-tool-part.')
}
