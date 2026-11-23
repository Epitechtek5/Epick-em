export interface StepScoring {
  win: number;
  draw: number;
  loss: number;
  placement: number[];
}

export interface StepRules {
  seeding: 'manual' | 'random' | 'ranking';
  qualification: 'random' | 'rank' | 'group_rank';
  best_of: 1 | 3 | 5;
  best_of_by_round: Record<string, 1 | 3 | 5>;
  scoring: StepScoring | null;
}

export const defaultStepRules: StepRules = {
  seeding: 'random',
  qualification: 'random',
  best_of: 1,
  best_of_by_round: {},
  scoring: null,
};

export type StepFormat = 'pool' | 'swiss' | 'single_elim' | 'double_elim';
export type StepMatchType = 'duel' | 'ffa';
export type StepStatus = 'pending' | 'ongoing' | 'finished';
export type StepParticipantStatus = 'in' | 'qualified' | 'eliminated';

export interface TournamentStep {
  id: string;
  tournament_id: string;
  position: number;
  format: StepFormat;
  match_type: StepMatchType;
  group_count: number;
  group_size: number;
  matches_per_group: number;
  advance_per_group: number;
  tiebreak: string[];
  rules?: StepRules;
  status: StepStatus;
  created_at: string;
  updated_at: string;
}

export type StepInput = Pick<
  TournamentStep,
  | 'position'
  | 'format'
  | 'match_type'
  | 'group_count'
  | 'group_size'
  | 'matches_per_group'
  | 'advance_per_group'
  | 'tiebreak'
  | 'rules'
>;

export type StepChanges = Partial<StepInput>;

export interface RankedStepParticipant {
  seed?: number | null;
  participant_id: string;
  points: number;
  rank: number;
  status: StepParticipantStatus;
}

export interface StepGroupRanking {
  group_id: string;
  index: number;
  participants: RankedStepParticipant[];
}

export interface CloseStepResult {
  step: TournamentStep;
  next_step: TournamentStep | null;
}
