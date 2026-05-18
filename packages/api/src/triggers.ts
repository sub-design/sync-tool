import type { Job, JobTriggerReason } from '@sync-tool/shared'

export type QueueReason = 'manual' | 'schedule' | 'watch' | 'startup' | 'folder-connect' | 'logoff'

export function canTriggerJob(job: Job | undefined, reason: JobTriggerReason): job is Job {
  if (!job) return false
  switch (reason) {
    case 'watch':
      return Boolean(job.watch)
    case 'folder-connect':
      return Boolean(job.autoOptions?.onFolderConnect)
    case 'logoff':
      return Boolean(job.autoOptions?.onLogoff)
  }
}
