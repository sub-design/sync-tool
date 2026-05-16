import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react';
import { cn } from './utils';

export type SortDirection = 'asc' | 'desc';

interface SortableTableHeaderProps {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
  className?: string;
  hint?: React.ReactNode;
}

export function SortableTableHeader({
  label,
  active,
  direction,
  onClick,
  className,
  hint,
}: SortableTableHeaderProps) {
  const Icon = active ? (direction === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;

  return (
    <th
      scope="col"
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('text-left px-6 h-9 text-xs font-medium text-muted-foreground', className)}
    >
      <div className="inline-flex h-full items-center gap-1.5">
        <button
          type="button"
          onClick={onClick}
          className="inline-flex h-full items-center gap-1.5 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span>{label}</span>
          <Icon className={cn('h-3.5 w-3.5', active ? 'text-foreground' : 'opacity-45')} aria-hidden="true" />
        </button>
        {hint}
      </div>
    </th>
  );
}
