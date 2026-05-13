import { Cron } from 'croner'

export const DEFAULT_SCHEDULER_POLL_MS = 60_000

export function shouldRunNow(expression: string, now = new Date(), lastRun?: number): boolean {
  let schedule: Cron
  try {
    schedule = new Cron(expression, { paused: true })
  } catch {
    return false
  }

  const currentMinute = floorToMinute(now)
  if (!schedule.match(currentMinute)) return false
  if (lastRun != null && floorToMinute(new Date(lastRun)).getTime() === currentMinute.getTime()) return false
  return true
}

export function schedulerPollMs(): number {
  return Math.max(100, parseInt(process.env.SCHEDULER_POLL_MS ?? String(DEFAULT_SCHEDULER_POLL_MS), 10))
}

function floorToMinute(date: Date): Date {
  const rounded = new Date(date)
  rounded.setSeconds(0, 0)
  return rounded
}
