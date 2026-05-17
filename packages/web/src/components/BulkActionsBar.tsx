import type { ReactNode } from 'react'
import { CheckSquare, X } from 'lucide-react'
import { Button } from './ui/button'

export interface BulkAction {
  label: string
  icon?: ReactNode
  onClick: () => void
  variant?: 'outline' | 'destructive' | 'secondary' | 'ghost'
  disabled?: boolean
}

interface BulkActionsBarProps {
  count: number
  itemLabel?: string
  meta?: ReactNode
  actions: BulkAction[]
  allSelected?: boolean
  onSelectAll?: () => void
  onClear: () => void
  selectAllLabel?: string
  deselectAllLabel?: string
  className?: string
}

export function BulkActionsBar({
  count,
  itemLabel = 'item',
  meta,
  actions,
  allSelected = false,
  onSelectAll,
  onClear,
  selectAllLabel = 'Select all',
  deselectAllLabel = 'Deselect all',
  className,
}: BulkActionsBarProps) {
  if (count === 0) return null

  return (
    <div className={className ?? 'sticky bottom-4 z-20 rounded-md border border-border bg-background/95 shadow-lg backdrop-blur-sm animate-in slide-in-from-bottom-2 duration-200'}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4">
        {onSelectAll && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={allSelected ? onClear : onSelectAll}
            >
              <CheckSquare className="w-4 h-4" />
              {allSelected ? deselectAllLabel : selectAllLabel}
            </Button>

            <div className="w-px h-5 bg-border" />
          </>
        )}

        <span className="text-sm font-medium text-foreground">
          {count} {itemLabel}{count === 1 ? '' : 's'} selected
          {meta && <span className="text-muted-foreground font-normal ml-1">{meta}</span>}
        </span>

        <div className="hidden flex-1 sm:block" />

        <div className="flex flex-wrap items-center gap-2">
          {actions.map((action) => (
            <Button
              key={action.label}
              size="sm"
              variant={action.variant ?? 'outline'}
              onClick={action.onClick}
              disabled={action.disabled}
              className="gap-1.5"
            >
              {action.icon}
              {action.label}
            </Button>
          ))}
        </div>

        <div className="w-px h-5 bg-border" />

        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground"
          onClick={onClear}
          title="Clear selection"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
