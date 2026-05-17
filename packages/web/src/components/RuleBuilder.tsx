import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface RuleCondition {
  field: string
  operator: 'equals' | 'not_equals' | 'contains' | 'starts_with' | 'ends_with'
  value: string
}

export interface RuleBuilderProps {
  conditions: RuleCondition[]
  onChange: (conditions: RuleCondition[]) => void
  availableFields?: string[]
}

const DEFAULT_FIELDS = ['platform', 'role', 'department', 'location']

const OPERATORS = [
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Not equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'ends_with', label: 'Ends with' },
] as const

export function RuleBuilder({ conditions, onChange, availableFields = DEFAULT_FIELDS }: RuleBuilderProps) {
  const addCondition = () => {
    onChange([
      ...conditions,
      { field: availableFields[0], operator: 'equals', value: '' }
    ])
  }

  const updateCondition = (index: number, updates: Partial<RuleCondition>) => {
    const newConditions = [...conditions]
    newConditions[index] = { ...newConditions[index], ...updates }
    onChange(newConditions)
  }

  const removeCondition = (index: number) => {
    onChange(conditions.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-3">
      {conditions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rules defined yet. Add a condition to start.</p>
      ) : (
        <div className="space-y-2">
          {conditions.map((condition, index) => (
            <div key={index} className="flex items-center gap-2">
              <Select
                value={condition.field}
                onValueChange={(value) => updateCondition(index, { field: value })}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Field" />
                </SelectTrigger>
                <SelectContent>
                  {availableFields.map((field) => (
                    <SelectItem key={field} value={field}>
                      {field}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={condition.operator}
                onValueChange={(value) => updateCondition(index, { operator: value as RuleCondition['operator'] })}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Operator" />
                </SelectTrigger>
                <SelectContent>
                  {OPERATORS.map((op) => (
                    <SelectItem key={op.value} value={op.value}>
                      {op.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                value={condition.value}
                onChange={(e) => updateCondition(index, { value: e.target.value })}
                placeholder="Value"
                className="flex-1"
              />

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive"
                onClick={() => removeCondition(index)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addCondition}
        className="w-full"
      >
        <Plus className="size-4 mr-2" />
        Add condition
      </Button>
    </div>
  )
}

export function buildRuleQuery(conditions: RuleCondition[]): string {
  return conditions
    .map(c => `${c.field}:${c.operator}:${c.value}`)
    .join(' AND ')
}

export function parseRuleQuery(query: string): RuleCondition[] {
  if (!query || query.trim() === '') return []

  const conditions: RuleCondition[] = []
  const parts = query.split(' AND ')

  for (const part of parts) {
    const segments = part.split(':')
    if (segments.length === 3) {
      const [field, operator, value] = segments.map(s => s.trim())
      if (['equals', 'not_equals', 'contains', 'starts_with', 'ends_with'].includes(operator)) {
        conditions.push({
          field,
          operator: operator as RuleCondition['operator'],
          value
        })
      }
    }
  }

  return conditions
}
