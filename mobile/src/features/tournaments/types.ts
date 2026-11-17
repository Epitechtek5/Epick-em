export type TournamentStatus =
  'draft' | 'registration' | 'ongoing' | 'finished' | 'cancelled';
export type ParticipantType = 'solo' | 'team';
export type TeamScoringMode = 'none' | 'sum' | 'best' | 'top_n';
export type ParticipantStatus =
  | 'pending'
  | 'rejected'
  | 'waitlisted'
  | 'registered'
  | 'checked_in'
  | 'absent'
  | 'disqualified'
  | 'withdrawn';
export type TournamentMode = 'online' | 'in_person' | 'hybrid';
export type TournamentVisibility = 'public' | 'invitation_only';
export type RegistrationPolicy = 'open' | 'approval_required';
export type RegistrationFieldType = 'text' | 'number' | 'select' | 'boolean';
export type TournamentRole = 'admin' | 'referee';
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
  mode: TournamentMode;
  location: string | null;
  visibility: TournamentVisibility;
  rules: string | null;
  team_min_starters: number | null;
  team_max_starters: number | null;
  team_max_substitutes: number | null;
  registration_policy: RegistrationPolicy;
  waiting_list_enabled: boolean;
  registration_fields: RegistrationField[];
  check_in_open_at: string | null;
  check_in_close_at: string | null;
  max_participants: number;
  team_scoring_mode: TeamScoringMode;
  team_scoring_n: number | null;
  status: TournamentStatus;
  owner_id: string | null;
  is_template: boolean;
  check_in_settled_at: string | null;
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
  | 'mode'
  | 'location'
  | 'visibility'
  | 'rules'
  | 'team_min_starters'
  | 'team_max_starters'
  | 'team_max_substitutes'
  | 'registration_policy'
  | 'waiting_list_enabled'
  | 'registration_fields'
  | 'check_in_open_at'
  | 'check_in_close_at'
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
  responses: Record<string, string | number | boolean>;
}

export interface RegistrationField {
  key: string;
  label: string;
  field_type: RegistrationFieldType;
  required: boolean;
  options: string[];
}

export interface TournamentRoleAssignment {
  user_id: string;
  role: TournamentRole;
  granted_by: string | null;
  granted_at: string;
}

export interface TournamentRoles {
  owner_id: string | null;
  roles: TournamentRoleAssignment[];
}

export interface TournamentInvitation {
  user_id: string;
  invited_by: string | null;
  invited_at: string;
}

export type PublicTournament = Omit<
  Tournament,
  | 'owner_id'
  | 'is_template'
  | 'check_in_settled_at'
  | 'team_scoring_mode'
  | 'team_scoring_n'
  | 'created_at'
  | 'updated_at'
>;

export interface PublicTournamentParticipant {
  id: string;
  kind: 'player' | 'team';
  name: string;
  team: string | null;
  status: ParticipantStatus;
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
