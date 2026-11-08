import type { MessageKey } from '@/i18n/context'
import type { TeamRole } from './types'

const ROLE_LABELS: Record<TeamRole, MessageKey> = {
  owner: 'teams.roles.owner',
  member: 'teams.roles.member',
  substitute: 'teams.roles.substitute',
}

export function teamRoleLabelKey(role: TeamRole): MessageKey {
  return ROLE_LABELS[role]
}
