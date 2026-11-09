import type { MessageKey } from '@/i18n/context'
import type { MatchType, StepFormat, StepParticipantStatus, StepStatus } from './types'

const FORMAT: Record<StepFormat, MessageKey> = {
  pool: 'steps.format.pool',
  swiss: 'steps.format.swiss',
  single_elim: 'steps.format.single_elim',
  double_elim: 'steps.format.double_elim',
}

const FORMAT_DESC: Record<StepFormat, MessageKey> = {
  pool: 'steps.formatDesc.pool',
  swiss: 'steps.formatDesc.swiss',
  single_elim: 'steps.formatDesc.single_elim',
  double_elim: 'steps.formatDesc.double_elim',
}

const MATCH_TYPE: Record<MatchType, MessageKey> = {
  duel: 'steps.matchType.duel',
  ffa: 'steps.matchType.ffa',
}

const MATCH_TYPE_DESC: Record<MatchType, MessageKey> = {
  duel: 'steps.matchTypeDesc.duel',
  ffa: 'steps.matchTypeDesc.ffa',
}

const STATUS: Record<StepStatus, MessageKey> = {
  pending: 'steps.status.pending',
  ongoing: 'steps.status.ongoing',
  finished: 'steps.status.finished',
}

const PARTICIPANT_STATUS: Record<StepParticipantStatus, MessageKey> = {
  in: 'steps.participantStatus.in',
  qualified: 'steps.participantStatus.qualified',
  eliminated: 'steps.participantStatus.eliminated',
}

export const formatLabelKey = (format: StepFormat) => FORMAT[format]
export const formatDescKey = (format: StepFormat) => FORMAT_DESC[format]
export const matchTypeLabelKey = (type: MatchType) => MATCH_TYPE[type]
export const matchTypeDescKey = (type: MatchType) => MATCH_TYPE_DESC[type]
export const stepStatusLabelKey = (status: StepStatus) => STATUS[status]
export const stepParticipantStatusLabelKey = (status: StepParticipantStatus) => PARTICIPANT_STATUS[status]
