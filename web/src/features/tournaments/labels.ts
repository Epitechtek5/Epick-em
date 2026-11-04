import type { MessageKey } from '@/i18n/context'
import type { ParticipantStatus, ParticipantType, ScoringMode, TeamScoringMode, TournamentStatus } from './types'

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
  registered: 'tournaments.participants.status.registered',
  checked_in: 'tournaments.participants.status.checked_in',
  disqualified: 'tournaments.participants.status.disqualified',
  withdrawn: 'tournaments.participants.status.withdrawn',
}

const SCORING_MODE: Record<ScoringMode, MessageKey> = {
  linear: 'tournaments.scoring.mode.linear',
  table: 'tournaments.scoring.mode.table',
}

export const statusLabelKey = (status: TournamentStatus) => STATUS[status]
export const transitionLabelKey = (status: TournamentStatus) => TRANSITION[status]
export const participantTypeLabelKey = (type: ParticipantType) => PARTICIPANT_TYPE[type]
export const teamScoringLabelKey = (mode: TeamScoringMode) => TEAM_SCORING[mode]
export const participantStatusLabelKey = (status: ParticipantStatus) => PARTICIPANT_STATUS[status]
export const scoringModeLabelKey = (mode: ScoringMode) => SCORING_MODE[mode]
