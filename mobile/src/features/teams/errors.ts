import { ApiError } from '@/lib/api';

export function teamErrorKey(error: unknown): string {
  if (!(error instanceof ApiError)) return 'errors.network';
  if (error.code) {
    const codes: Record<string, string> = {
      team_name_taken: 'teams.errors.nameTaken',
      already_team_member: 'teams.errors.alreadyMember',
      team_already_registered: 'teams.errors.alreadyRegistered',
      player_already_registered: 'teams.errors.playerRegistered',
    };
    if (codes[error.code]) return codes[error.code];
  }
  if (error.status === 413) return 'teams.validation.fileSize';
  if (error.status === 400) {
    const fields: Record<string, string> = {
      name: 'teams.validation.name',
      tag: 'teams.validation.tag',
      picture_url: 'teams.validation.picture',
      game_id: 'teams.validation.game',
      user_id: 'teams.errors.memberInvalid',
      role: 'teams.errors.ownerRole',
      team_id: 'teams.errors.notFound',
      member_ids: 'teams.errors.memberSelection',
    };
    for (const field of error.fields) {
      if (fields[field]) return fields[field];
    }
  }
  const statuses: Record<number, string> = {
    400: 'errors.invalid',
    401: 'errors.unauthorized',
    403: 'errors.forbidden',
    404: 'teams.errors.notFound',
  };
  return statuses[error.status] ?? 'errors.server';
}

export function teamErrorMessage(
  error: unknown,
  translate: (key: string) => string,
): string {
  if (error instanceof ApiError && error.fileDetails) return error.fileDetails;
  return translate(teamErrorKey(error));
}
