import { ApiError } from '@/lib/api';

const fieldKeys: Record<string, string> = {
  position: 'steps.validation.position',
  format: 'steps.validation.format',
  match_type: 'steps.validation.matchType',
  group_count: 'steps.validation.groupCount',
  group_size: 'steps.validation.groupSize',
  matches_per_group: 'steps.validation.matchesPerGroup',
  advance_per_group: 'steps.validation.advancePerGroup',
  tiebreak: 'steps.validation.tiebreak',
  steps: 'steps.validation.chain',
  participants: 'steps.validation.participants',
};

export function stepErrorKey(error: unknown): string {
  if (!(error instanceof ApiError)) return 'errors.network';
  if (error.status === 400) {
    for (const field of error.fields) {
      if (fieldKeys[field]) return fieldKeys[field];
    }
    return 'errors.invalid';
  }
  if (error.status === 401) return 'errors.unauthorized';
  if (error.status === 403) return 'errors.forbidden';
  if (error.status === 404) return 'steps.errors.notFound';
  if (error.status === 409) return 'steps.errors.conflict';
  return 'errors.server';
}
