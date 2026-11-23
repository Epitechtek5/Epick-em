import type { MessageKey } from '@/i18n/context'
import type { StatScope, StatType } from './types'

const TYPE: Record<StatType, MessageKey> = {
  flat: 'stats.typeFlat',
  percent: 'stats.typePercent',
  select: 'stats.typeSelect',
  mvp: 'stats.typeMvp',
}

const SCOPE: Record<StatScope, MessageKey> = {
  participant: 'stats.scopeParticipant',
  match: 'stats.scopeMatch',
}

export const statTypeLabelKey = (type: StatType): MessageKey => TYPE[type] ?? 'stats.typeFlat'
export const statScopeLabelKey = (scope: StatScope): MessageKey => SCOPE[scope] ?? 'stats.scopeParticipant'
