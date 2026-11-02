export type TournamentStatus =
  'draft' | 'registration' | 'ongoing' | 'finished' | 'cancelled';
export type ParticipantType = 'solo' | 'team';
export type TeamScoringMode = 'none' | 'sum' | 'best' | 'top_n';
export type ParticipantStatus =
  'registered' | 'checked_in' | 'disqualified' | 'withdrawn';
export type ScoringMode = 'linear' | 'table';
export type TournamentFormat = 'json' | 'csv';

export interface Tournament {
  id: string;
  game_id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  registration_open_at: string | null;
  registration_close_at: string | null;
  participant_type: ParticipantType;
  team_size: number | null;
  max_participants: number;
  team_scoring_mode: TeamScoringMode;
  team_scoring_n: number | null;
  status: TournamentStatus;
  created_at: string;
  updated_at: string;
}

export type TournamentInput = Pick<
  Tournament,
  | 'game_id'
  | 'name'
  | 'description'
  | 'start_date'
  | 'end_date'
  | 'registration_open_at'
  | 'registration_close_at'
  | 'participant_type'
  | 'team_size'
  | 'max_participants'
  | 'team_scoring_mode'
  | 'team_scoring_n'
>;

export type TournamentChanges = Partial<
  Omit<TournamentInput, 'game_id' | 'participant_type'>
>;

export interface TournamentParticipant {
  id: string;
  tournament_id: string;
  user_id: string | null;
  tournament_team_id: string | null;
  status: ParticipantStatus;
  registered_at: string;
}

export interface ScoringRule {
  id: string;
  tournament_id: string;
  stat_id: string;
  mode: ScoringMode;
  coefficient: number | null;
  points_table: Record<string, number> | null;
}

export type ScoringDefinition =
  | { mode: 'linear'; coefficient: number }
  | { mode: 'table'; points_table: Record<string, number> };

export interface PlayerRank {
  rank: number;
  participant_id: string;
  user_id: string;
  tournament_team_id: string | null;
  points: number;
}

export interface TeamRank {
  rank: number;
  tournament_team_id: string;
  name: string;
  points: number;
}

export interface TournamentImportReport {
  created: number;
  updated: number;
}
