import type { MembershipRule, DeviceTags } from '@sync-tool/shared'

/**
 * Rule condition structure
 */
export interface RuleCondition {
  field: string
  operator: 'equals' | 'not_equals' | 'contains' | 'starts_with' | 'ends_with'
  value: string
}

/**
 * Parse a rule query string into conditions
 * Query format: "field:operator:value AND field2:operator2:value2"
 * Example: "platform:equals:macos AND role:equals:workstation"
 */
export function parseRuleQuery(query: string): RuleCondition[] {
  if (!query || query.trim() === '') return []

  const conditions: RuleCondition[] = []
  const parts = query.split(' AND ')

  for (const part of parts) {
    const segments = part.split(':')
    if (segments.length === 3) {
      const [field, operator, value] = segments.map(s => s.trim())
      if (isValidOperator(operator)) {
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

/**
 * Build a rule query string from conditions
 */
export function buildRuleQuery(conditions: RuleCondition[]): string {
  return conditions
    .map(c => `${c.field}:${c.operator}:${c.value}`)
    .join(' AND ')
}

/**
 * Validate operator
 */
function isValidOperator(op: string): op is RuleCondition['operator'] {
  return ['equals', 'not_equals', 'contains', 'starts_with', 'ends_with'].includes(op)
}

/**
 * Evaluate a single condition against device tags
 */
function evaluateCondition(condition: RuleCondition, tags: DeviceTags): boolean {
  const fieldValue = tags[condition.field]

  if (fieldValue === undefined || fieldValue === null) {
    return false
  }

  switch (condition.operator) {
    case 'equals':
      return fieldValue === condition.value
    case 'not_equals':
      return fieldValue !== condition.value
    case 'contains':
      return fieldValue.toLowerCase().includes(condition.value.toLowerCase())
    case 'starts_with':
      return fieldValue.toLowerCase().startsWith(condition.value.toLowerCase())
    case 'ends_with':
      return fieldValue.toLowerCase().endsWith(condition.value.toLowerCase())
    default:
      return false
  }
}

/**
 * Evaluate a membership rule against device tags
 * All conditions must be satisfied (AND logic)
 */
export function evaluateRule(rule: MembershipRule | undefined, tags: DeviceTags): boolean {
  if (!rule || !rule.query) {
    return false
  }

  const conditions = parseRuleQuery(rule.query)
  if (conditions.length === 0) {
    return false
  }

  return conditions.every(condition => evaluateCondition(condition, tags))
}

/**
 * Get device IDs that match a membership rule
 */
export async function getMatchingDeviceIds(
  rule: MembershipRule | undefined,
  devices: Array<{ id: string; tags?: DeviceTags }>
): Promise<string[]> {
  if (!rule || !rule.query) {
    return []
  }

  return devices
    .filter(device => device.tags && evaluateRule(rule, device.tags))
    .map(device => device.id)
}
