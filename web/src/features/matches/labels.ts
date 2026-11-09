import type { MessageKey } from '@/i18n/context'
import type { Bracket, MatchResult, MatchStatus } from './types'

const STATUS: Record<MatchStatus, MessageKey> = {
  scheduled: 'matches.status.scheduled',
  ongoing: 'matches.status.ongoing',
  finished: 'matches.status.finished',
  cancelled: 'matches.status.cancelled',
}

const BRACKET: Record<Bracket, MessageKey> = {
  winners: 'matches.bracket.winners',
  losers: 'matches.bracket.losers',
  grand_final: 'matches.bracket.grand_final',
}

const RESULT: Record<MatchResult, MessageKey> = {
  win: 'matches.result.win',
  loss: 'matches.result.loss',
  draw: 'matches.result.draw',
}

export const matchStatusLabelKey = (status: MatchStatus) => STATUS[status]
export const bracketLabelKey = (bracket: Bracket) => BRACKET[bracket]
export const resultLabelKey = (result: MatchResult) => RESULT[result]
