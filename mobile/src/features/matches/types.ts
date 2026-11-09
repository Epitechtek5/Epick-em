import type { CloseStepResult } from '@/features/steps/types';
export const statuses = [
  'scheduled',
  'ongoing',
  'finished',
  'cancelled',
] as const;
export const brackets = ['winners', 'losers', 'grand_final'] as const;
export const outcomes = ['win', 'loss', 'draw'] as const;
export type MatchStatus = (typeof statuses)[number];
export type Bracket = (typeof brackets)[number];
export type Result = (typeof outcomes)[number];
export type FlatStats = Record<string, number>;
export type TeamStats = {
  total: FlatStats;
  players?: Record<string, FlatStats>;
};
export interface Score {
  participant_id: string;
  stats: FlatStats | TeamStats;
  rank: number | null;
  result: Result | null;
}
export interface MatchFields {
  round: number | null;
  bracket: Bracket | null;
  scheduled_at: string | null;
  next_match_id: string | null;
}
export interface MatchInput extends MatchFields {
  group_id: string;
  participant_ids: string[];
}
export type MatchChanges = Partial<Omit<MatchInput, 'group_id'>>;
export interface Match extends MatchFields {
  id: string;
  game_id: string;
  step_id: string;
  group_id: string | null;
  status: MatchStatus;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  participants: (Score & { points: number; match_id: string })[];
}
export type MatchOutcome = Match & { step_closed: CloseStepResult | null };
