import { ApiError } from '@/lib/api';
import { gameId } from '@/features/games/validation';
import type { StatChanges, StatFieldErrors, StatValues } from './types';

export function statId(id: string): string {
  try {
    return gameId(id);
  } catch {
    throw new ApiError(404, 'Invalid statistic UUID');
  }
}

export function validateStat(values: StatValues): StatFieldErrors {
  const errors: StatFieldErrors = {};
  const nameLength = Array.from(values.name.trim()).length;

  if (nameLength < 1 || nameLength > 64) {
    errors.name = 'stats.validation.name';
  }
  if (
    values.key.trim().length > 64 ||
    !/^[a-z0-9]+(_[a-z0-9]+)*$/.test(values.key.trim())
  ) {
    errors.key = 'stats.validation.key';
  }
  if (!['flat', 'percent', 'select', 'mvp'].includes(values.type)) {
    errors.type = 'stats.validation.type';
  }

  const scope =
    values.scope ?? (values.type === 'mvp' ? 'match' : 'participant');
  if (
    !['participant', 'match'].includes(scope) ||
    (values.type === 'mvp' && scope !== 'match') ||
    (['flat', 'percent'].includes(values.type) && scope !== 'participant')
  ) {
    errors.scope = 'stats.validation.scope';
  }
  return errors;
}

export function changedStatFields(
  original: StatValues,
  next: StatValues,
): StatChanges {
  const changes: StatChanges = {};
  if (original.name !== next.name.trim()) changes.name = next.name.trim();
  if (original.key !== next.key.trim()) changes.key = next.key.trim();
  if (original.type !== next.type) changes.type = next.type;
  if (
    (original.scope ?? (original.type === 'mvp' ? 'match' : 'participant')) !==
      next.scope &&
    next.scope
  )
    changes.scope = next.scope;
  return changes;
}
