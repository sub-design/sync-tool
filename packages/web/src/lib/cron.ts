import cronstrue from 'cronstrue'

export function describeCron(expr: string): string {
  try {
    return cronstrue.toString(expr, { use24HourTimeFormat: true, verbose: false })
  } catch {
    return expr
  }
}
