import type { MessageKey } from '@/i18n/context'
import type { StatType } from './types'

export function statTypeLabelKey(type: StatType): MessageKey {
  return type === 'flat' ? 'stats.typeFlat' : 'stats.typePercent'
}
