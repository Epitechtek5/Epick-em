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
>;

export type StepChanges = Partial<StepInput>;

export interface RankedStepParticipant {
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
