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
  if (values.type !== 'flat' && values.type !== 'percent') {
    errors.type = 'stats.validation.type';
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
  return changes;
}
