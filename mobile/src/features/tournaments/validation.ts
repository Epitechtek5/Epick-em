import type {
  ScoringDefinition,
  TeamScoringMode,
  Tournament,
  TournamentChanges,
  TournamentInput,
} from './types';

export function allowedTransitions(
  status: Tournament['status'],
): Tournament['status'][] {
  switch (status) {
    case 'draft':
      return ['registration', 'cancelled'];
    case 'registration':
      return ['ongoing', 'cancelled'];
    case 'ongoing':
      return ['finished', 'cancelled'];
    default:
      return [];
  }
}

export function normalizeDate(value: string): string | null {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value.trim(),
    )
  )
    return null;
  const date = new Date(value);
  return value.trim() && Number.isFinite(date.getTime())
    ? date.toISOString()
    : null;
}

export function validateTournament(input: TournamentInput): string | null {
  if (!input.game_id) return 'tournaments.validation.game';
  if (!input.name.trim() || Array.from(input.name.trim()).length > 128)
    return 'tournaments.validation.name';
  if (Array.from(input.description ?? '').length > 4000)
    return 'tournaments.validation.description';
  if (!normalizeDate(input.start_date) || !normalizeDate(input.end_date))
    return 'tournaments.validation.dates';
  if (new Date(input.start_date) >= new Date(input.end_date))
    return 'tournaments.validation.dates';
  if (input.registration_open_at && !normalizeDate(input.registration_open_at))
    return 'tournaments.validation.dates';
  if (
    input.registration_close_at &&
    !normalizeDate(input.registration_close_at)
  )
    return 'tournaments.validation.dates';
  if (
    input.registration_open_at &&
    input.registration_close_at &&
    new Date(input.registration_open_at) > new Date(input.registration_close_at)
  )
    return 'tournaments.validation.dates';
  if (
    (input.check_in_open_at && !normalizeDate(input.check_in_open_at)) ||
    (input.check_in_close_at && !normalizeDate(input.check_in_close_at)) ||
    (input.check_in_open_at &&
      input.check_in_close_at &&
      new Date(input.check_in_open_at) >= new Date(input.check_in_close_at))
  )
    return 'tournaments.validation.checkIn';
  if (input.mode !== 'online' && !input.location?.trim())
    return 'tournaments.validation.location';
  const fieldKeys = new Set<string>();
  if (
    input.registration_fields.length > 30 ||
    input.registration_fields.some((field) => {
      const duplicate = fieldKeys.has(field.key);
      fieldKeys.add(field.key);
      return (
        duplicate ||
        !/^[A-Za-z0-9_]{1,40}$/.test(field.key) ||
        !field.label.trim() ||
        Array.from(field.label.trim()).length > 100 ||
        (field.field_type === 'select' && field.options.length === 0)
      );
    })
  )
    return 'tournaments.validation.registrationFields';
  if (
    !Number.isInteger(input.max_participants) ||
    input.max_participants < 1 ||
    input.max_participants > 10000
  )
    return 'tournaments.validation.capacity';
  if (
    input.participant_type === 'team' &&
    (!Number.isInteger(input.team_min_starters) ||
      !Number.isInteger(input.team_max_starters) ||
      (input.team_min_starters ?? 0) < 1 ||
      (input.team_max_starters ?? 0) < (input.team_min_starters ?? 0) ||
      (input.team_max_starters ?? 0) > 100 ||
      (input.team_max_substitutes !== null &&
        (!Number.isInteger(input.team_max_substitutes) ||
          input.team_max_substitutes < 0 ||
          input.team_max_substitutes > 100)))
  )
    return 'tournaments.validation.teamSize';
  if (
    input.team_scoring_mode === 'top_n' &&
    (!Number.isInteger(input.team_scoring_n) ||
      (input.team_scoring_n ?? 0) < 1 ||
      (input.team_scoring_n ?? 0) > 100)
  )
    return 'tournaments.validation.topN';
  return null;
}

export function buildTournamentInput(input: TournamentInput): TournamentInput {
  const mode: TeamScoringMode =
    input.participant_type === 'solo' ? input.team_scoring_mode : 'none';
  return {
    ...input,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    start_date: normalizeDate(input.start_date) ?? input.start_date,
    end_date: normalizeDate(input.end_date) ?? input.end_date,
    registration_open_at: input.registration_open_at
      ? normalizeDate(input.registration_open_at)
      : null,
    registration_close_at: input.registration_close_at
      ? normalizeDate(input.registration_close_at)
      : null,
    location: input.mode === 'online' ? null : input.location?.trim() || null,
    rules: input.rules?.trim() || null,
    team_min_starters:
      input.participant_type === 'team' ? input.team_min_starters : null,
    team_max_starters:
      input.participant_type === 'team' ? input.team_max_starters : null,
    team_max_substitutes:
      input.participant_type === 'team' ? input.team_max_substitutes : null,
    check_in_open_at: input.check_in_open_at
      ? normalizeDate(input.check_in_open_at)
      : null,
    check_in_close_at: input.check_in_close_at
      ? normalizeDate(input.check_in_close_at)
      : null,
    team_scoring_mode: mode,
    team_scoring_n: mode === 'top_n' ? input.team_scoring_n : null,
  };
}

export function changedTournamentFields(
  current: Tournament,
  next: TournamentInput,
): TournamentChanges {
  const changes: TournamentChanges = {};
  const fields: (keyof TournamentChanges)[] = [
    'name',
    'description',
    'start_date',
    'end_date',
    'registration_open_at',
    'registration_close_at',
    'mode',
    'location',
    'visibility',
    'rules',
    'team_min_starters',
    'team_max_starters',
    'team_max_substitutes',
    'registration_policy',
    'waiting_list_enabled',
    'registration_fields',
    'check_in_open_at',
    'check_in_close_at',
    'max_participants',
  ];
  if (current.participant_type === 'solo') {
    fields.push('team_scoring_mode', 'team_scoring_n');
  }
  for (const field of fields) {
    if (
      [
        'start_date',
        'end_date',
        'registration_open_at',
        'registration_close_at',
      ].includes(field) &&
      current[field] &&
      next[field] &&
      new Date(current[field] as string).getTime() ===
        new Date(next[field] as string).getTime()
    )
      continue;
    if (current[field] !== next[field]) {
      Object.assign(changes, { [field]: next[field] });
    }
  }
  return changes;
}

export function parseScoringDefinition(
  mode: 'linear' | 'table',
  value: string,
): ScoringDefinition | null {
  if (mode === 'linear') {
    const coefficient = Number(value);
    return value.trim() && Number.isFinite(coefficient)
      ? { mode, coefficient }
      : null;
  }
  try {
    const table: unknown = JSON.parse(value);
    if (!table || typeof table !== 'object' || Array.isArray(table))
      return null;
    const entries = Object.entries(table);
    if (
      !entries.length ||
      entries.some(
        ([key, points]) =>
          !key.trim() ||
          !Number.isFinite(Number(key)) ||
          typeof points !== 'number' ||
          !Number.isFinite(points),
      )
    )
      return null;
    return { mode, points_table: table as Record<string, number> };
  } catch {
    return null;
  }
}
