import cronstrue from 'cronstrue'
import { Cron } from 'croner'

export function describeCron(expr: string): string {
  try {
    return cronstrue.toString(expr, { use24HourTimeFormat: true, verbose: false })
  } catch {
    return expr
  }
}

export function getNextCronRun(expr: string): number | null {
  try {
    const job = new Cron(expr, { paused: true })
    const next = job.nextRun()
    return next ? next.getTime() : null
  } catch {
    return null
  }
}
