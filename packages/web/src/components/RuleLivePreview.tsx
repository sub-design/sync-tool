import { useQuery } from '@tanstack/react-query'
import { HardDrive, AlertCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { MembershipRule } from '@/types'
import { buildRuleQuery, type RuleCondition } from './RuleBuilder'
import * as api from '@/lib/api'

export interface RuleLivePreviewProps {
  conditions: RuleCondition[]
  membershipRule?: MembershipRule
}

export function RuleLivePreview({ conditions, membershipRule }: RuleLivePreviewProps) {
  const rule = membershipRule || {
    query: buildRuleQuery(conditions),
    description: 'Custom rule',
  }

  const { data: preview, isLoading, error } = useQuery({
    queryKey: ['rule-preview', rule.query],
    queryFn: () => api.previewRule(rule),
    enabled: rule.query !== '',
  })

  if (rule.query === '') {
    return (
      <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
        <p>Add conditions to see matching devices.</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
        <p>Evaluating rule...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        <div className="flex items-center gap-2">
          <AlertCircle className="size-4" />
          <p>Failed to evaluate rule. Please check your conditions.</p>
        </div>
      </div>
    )
  }

  if (!preview) {
    return null
  }

  const { matchingCount, totalCount, devices } = preview

  return (
    <div className="rounded-md border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm">
          <span className="font-medium">{matchingCount}</span> of{' '}
          <span className="font-medium">{totalCount}</span> devices match this rule
        </div>
        <Badge variant={matchingCount === 0 ? 'destructive' : 'secondary'}>
          {matchingCount === 0 ? 'No matches' : matchingCount === totalCount ? 'All devices' : 'Partial match'}
        </Badge>
      </div>

      {devices.length > 0 ? (
        <div className="max-h-48 overflow-y-auto space-y-1">
          {devices.map((device) => (
            <div key={device.id} className="flex items-center gap-2 text-sm p-2 rounded hover:bg-muted/50">
              <HardDrive className="size-4 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate">{device.name}</span>
              {device.tags && (
                <div className="flex gap-1 shrink-0">
                  {Object.entries(device.tags).map(([key, value]) => (
                    <Badge key={key} variant="outline" className="text-xs">
                      {key}: {String(value)}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No devices match this rule.</p>
      )}
    </div>
  )
}
