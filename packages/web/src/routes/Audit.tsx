import { useQuery } from '@tanstack/react-query'
import Shell from '@/components/Shell'
import * as api from '@/lib/api'
import { formatRelative } from '@/lib/format'

export default function Audit() {
  const { data: entries = [] } = useQuery({
    queryKey: ['audit'],
    queryFn:  () => api.listAudit(150),
  })

  return (
    <Shell>
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Security Events
        </h2>

        {entries.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
            No audit events yet.
          </div>
        ) : (
          <div className="rounded-lg border divide-y">
            {entries.map((entry) => (
              <div key={entry.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0">
                  <p className="font-medium">{labelForAction(entry.action)}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.actorType}
                    {entry.actorId ? ` ${entry.actorId}` : ''}
                    {entry.targetType && entry.targetId ? ` -> ${entry.targetType} ${entry.targetId}` : ''}
                  </p>
                  {Object.keys(entry.metadata ?? {}).length > 0 && (
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {JSON.stringify(entry.metadata)}
                    </p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatRelative(entry.createdAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </Shell>
  )
}

function labelForAction(action: string): string {
  return action
    .split('.')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).replace(/_/g, ' '))
    .join(' ')
}
