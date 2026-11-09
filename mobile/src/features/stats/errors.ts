import { ApiError } from '@/lib/api';
import type { StatFieldErrors } from './types';

export function statErrorKey(error: unknown): string {
  if (!(error instanceof ApiError)) return 'errors.network';
  if (error.code === 'stat_key_taken') return 'stats.errors.keyTaken';
  if (error.code === 'stat_in_use') return 'stats.errors.inUse';
  if (error.status === 404) return 'stats.errors.notFound';
  if (error.status === 413) return 'stats.validation.fileSize';
  if (error.status === 400 && error.fields.includes('file')) {
    return 'stats.errors.file';
  }
  if (error.status === 400) return 'errors.invalid';
  if (error.status === 401) return 'errors.unauthorized';
  if (error.status === 403) return 'errors.forbidden';
  return 'errors.server';
}

export function statFieldErrors(error: unknown): StatFieldErrors {
  if (!(error instanceof ApiError)) return {};
  if (error.code === 'stat_key_taken') {
    return { key: 'stats.errors.keyTaken' };
  }
  if (error.status !== 400) return {};

  const fields: StatFieldErrors = {};
  for (const field of error.fields) {
    if (field === 'name' || field === 'key' || field === 'type') {
      fields[field] = `stats.validation.${field}`;
    }
  }
  return fields;
}
