import type { MessageKey, Params } from '@/i18n/context'
import type {
  MatchType,
  QualificationPlacement,
  SeedingStrategy,
  StepFormat,
  StepParticipantStatus,
  StepStatus,
  TiebreakCriterion,
} from './types'
import { isSupportedCriterion } from './validation'

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

const SEEDING: Record<SeedingStrategy, MessageKey> = {
  random: 'steps.rules.seedingOptions.random',
  ranking: 'steps.rules.seedingOptions.ranking',
  manual: 'steps.rules.seedingOptions.manual',
}

const SEEDING_DESC: Record<SeedingStrategy, MessageKey> = {
  random: 'steps.rules.seedingDesc.random',
  ranking: 'steps.rules.seedingDesc.ranking',
  manual: 'steps.rules.seedingDesc.manual',
}

const QUALIFICATION: Record<QualificationPlacement, MessageKey> = {
  random: 'steps.rules.qualificationOptions.random',
  rank: 'steps.rules.qualificationOptions.rank',
  group_rank: 'steps.rules.qualificationOptions.group_rank',
}

const QUALIFICATION_DESC: Record<QualificationPlacement, MessageKey> = {
  random: 'steps.rules.qualificationDesc.random',
  rank: 'steps.rules.qualificationDesc.rank',
  group_rank: 'steps.rules.qualificationDesc.group_rank',
}

const CRITERION: Record<TiebreakCriterion, MessageKey> = {
  head_to_head: 'steps.criteria.head_to_head',
  game_differential: 'steps.criteria.game_differential',
  buchholz: 'steps.criteria.buchholz',
}

const CRITERION_DESC: Record<TiebreakCriterion, MessageKey> = {
  head_to_head: 'steps.criteriaDesc.head_to_head',
  game_differential: 'steps.criteriaDesc.game_differential',
  buchholz: 'steps.criteriaDesc.buchholz',
}

export const seedingLabelKey = (value: SeedingStrategy) => SEEDING[value]
export const seedingDescKey = (value: SeedingStrategy) => SEEDING_DESC[value]
export const qualificationLabelKey = (value: QualificationPlacement) => QUALIFICATION[value]
export const qualificationDescKey = (value: QualificationPlacement) => QUALIFICATION_DESC[value]
export const tiebreakDescKey = (value: TiebreakCriterion) => CRITERION_DESC[value]

// Nom d'un critère de départage ; une clé historique non évaluée s'affiche telle quelle.
export function tiebreakLabel(t: (key: MessageKey, params?: Params) => string, key: string): string {
  return isSupportedCriterion(key) ? t(CRITERION[key]) : key
}
