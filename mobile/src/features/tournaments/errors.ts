import { ApiError } from '@/lib/api';
import { GameFileError } from '@/features/games/files';

export function tournamentErrorKey(error: unknown): string {
  if (error instanceof GameFileError) return error.key;
  if (!(error instanceof ApiError)) return 'errors.network';
  if (error.status === 400 && error.fields.includes('file'))
    return 'tournaments.errors.file';
  if (error.status === 400) {
    const fields: Record<string, string> = {
      game_id: 'tournaments.validation.game',
      name: 'tournaments.validation.name',
      description: 'tournaments.validation.description',
      start_date: 'tournaments.validation.dates',
      end_date: 'tournaments.validation.dates',
      registration_open_at: 'tournaments.validation.dates',
      registration_close_at: 'tournaments.validation.dates',
      team_size: 'tournaments.validation.teamSize',
      max_participants: 'tournaments.validation.capacity',
      team_scoring_n: 'tournaments.validation.topN',
      tournament_team_id: 'tournaments.errors.teamInvalid',
      stat_id: 'tournaments.errors.statInvalid',
      coefficient: 'tournaments.validation.scoring',
      points_table: 'tournaments.validation.scoring',
    };
    for (const field of error.fields) {
      if (fields[field]) return fields[field];
    }
    return 'errors.invalid';
  }
  if (error.status === 401) return 'errors.unauthorized';
  if (error.status === 403) return 'errors.forbidden';
  if (error.status === 404) return 'tournaments.errors.notFound';
  if (error.status === 413) return 'tournaments.validation.fileSize';
  if (error.status === 409) {
    const known: Record<string, string> = {
      tournament_name_taken: 'tournaments.errors.nameTaken',
      scoring_rule_taken: 'tournaments.errors.ruleTaken',
      already_registered: 'tournaments.errors.alreadyRegistered',
      tournament_full: 'tournaments.errors.full',
      tournament_locked: 'tournaments.errors.locked',
      registration_closed: 'tournaments.errors.registrationClosed',
      invalid_status_transition: 'tournaments.errors.transition',
    };
    return (error.code && known[error.code]) || 'tournaments.errors.conflict';
  }
  return 'errors.server';
}
