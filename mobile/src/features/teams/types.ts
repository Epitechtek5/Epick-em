export type TeamRole = 'owner' | 'member' | 'substitute';
export type AssignableTeamRole = Exclude<TeamRole, 'owner'>;
export interface Team {
  id: string;
  game_id: string;
  name: string;
  tag: string | null;
  picture_url: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
}
export interface TeamMember {
  user_id: string;
  role: TeamRole;
  joined_at: string;
  left_at: string | null;
}
export interface TournamentTeam {
  id: string;
  tournament_id: string;
  team_id: string | null;
  name: string;
  tag: string | null;
  picture_url: string | null;
  owner_id: string;
  created_at: string;
}
export interface TournamentTeamMember {
  user_id: string;
  role: TeamRole;
}
export interface TeamValues {
  name: string;
  tag: string;
  picture_url: string;
}
export type TeamChanges = Partial<TeamValues>;
export type TeamFormat = 'json' | 'csv';
export interface TeamImportReport {
  created: number;
  updated: number;
}
