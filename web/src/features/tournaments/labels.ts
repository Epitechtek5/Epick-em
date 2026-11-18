import type { MessageKey } from '@/i18n/context'
import type {
  FieldType,
  ParticipantStatus,
  ParticipantType,
  RegistrationPolicy,
  ScoringMode,
  TeamScoringMode,
  TournamentMode,
  TournamentRole,
  TournamentStatus,
  Visibility,
} from './types'

const STATUS: Record<TournamentStatus, MessageKey> = {
  draft: 'tournaments.status.draft',
  registration: 'tournaments.status.registration',
  ongoing: 'tournaments.status.ongoing',
  finished: 'tournaments.status.finished',
  cancelled: 'tournaments.status.cancelled',
}

// Libellé du bouton qui mène à ce statut.
const TRANSITION: Record<TournamentStatus, MessageKey> = {
  draft: 'tournaments.lifecycle.toDraft',
  registration: 'tournaments.lifecycle.toRegistration',
  ongoing: 'tournaments.lifecycle.toOngoing',
  finished: 'tournaments.lifecycle.toFinished',
  cancelled: 'tournaments.lifecycle.toCancelled',
}

const PARTICIPANT_TYPE: Record<ParticipantType, MessageKey> = {
  solo: 'tournaments.participantType.solo',
  team: 'tournaments.participantType.team',
}

const TEAM_SCORING: Record<TeamScoringMode, MessageKey> = {
  none: 'tournaments.teamScoring.none',
  sum: 'tournaments.teamScoring.sum',
  best: 'tournaments.teamScoring.best',
  top_n: 'tournaments.teamScoring.top_n',
}

const PARTICIPANT_STATUS: Record<ParticipantStatus, MessageKey> = {
  pending: 'tournaments.participants.status.pending',
  rejected: 'tournaments.participants.status.rejected',
  waitlisted: 'tournaments.participants.status.waitlisted',
  absent: 'tournaments.participants.status.absent',
  registered: 'tournaments.participants.status.registered',
  checked_in: 'tournaments.participants.status.checked_in',
  disqualified: 'tournaments.participants.status.disqualified',
  withdrawn: 'tournaments.participants.status.withdrawn',
}

const SCORING_MODE: Record<ScoringMode, MessageKey> = {
  linear: 'tournaments.scoring.mode.linear',
  table: 'tournaments.scoring.mode.table',
}

const MODE: Record<TournamentMode, MessageKey> = {
  online: 'tournaments.mode.online',
  in_person: 'tournaments.mode.in_person',
  hybrid: 'tournaments.mode.hybrid',
}

const VISIBILITY: Record<Visibility, MessageKey> = {
  public: 'tournaments.visibility.public',
  invitation_only: 'tournaments.visibility.invitation_only',
}

const POLICY: Record<RegistrationPolicy, MessageKey> = {
  open: 'tournaments.policy.open',
  approval_required: 'tournaments.policy.approval_required',
}

const FIELD_TYPE: Record<FieldType, MessageKey> = {
  text: 'tournaments.fields.type.text',
  number: 'tournaments.fields.type.number',
  select: 'tournaments.fields.type.select',
  boolean: 'tournaments.fields.type.boolean',
}

const ROLE: Record<'owner' | TournamentRole, MessageKey> = {
  owner: 'tournaments.management.role.owner',
  admin: 'tournaments.management.role.admin',
  referee: 'tournaments.management.role.referee',
}

export const modeLabelKey = (mode: TournamentMode) => MODE[mode]
export const visibilityLabelKey = (visibility: Visibility) => VISIBILITY[visibility]
export const policyLabelKey = (policy: RegistrationPolicy) => POLICY[policy]
export const fieldTypeLabelKey = (type: FieldType) => FIELD_TYPE[type]
export const roleLabelKey = (role: 'owner' | TournamentRole) => ROLE[role]
export const statusLabelKey = (status: TournamentStatus) => STATUS[status]
export const transitionLabelKey = (status: TournamentStatus) => TRANSITION[status]
export const participantTypeLabelKey = (type: ParticipantType) => PARTICIPANT_TYPE[type]
export const teamScoringLabelKey = (mode: TeamScoringMode) => TEAM_SCORING[mode]
export const participantStatusLabelKey = (status: ParticipantStatus) => PARTICIPANT_STATUS[status]
export const scoringModeLabelKey = (mode: ScoringMode) => SCORING_MODE[mode]
