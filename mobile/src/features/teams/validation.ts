import { ApiError } from '@/lib/api';
import type { TeamChanges, TeamValues } from './types';

export const MAX_TEAM_IMPORT_BYTES = 256 * 1024;

export function teamId(id: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw new ApiError(404, 'Invalid UUID');
  }
  return id;
}

export function ownsTeam(ownerId: string, userId?: string): boolean {
  return Boolean(userId && ownerId === userId);
}

export function validateTeam(
  values: TeamValues,
): Partial<Record<keyof TeamValues, string>> {
  const errors: Partial<Record<keyof TeamValues, string>> = {};
  const nameLength = Array.from(values.name.trim()).length;
  const tagLength = Array.from(values.tag.trim()).length;
  const url = values.picture_url.trim();
  if (nameLength < 1 || nameLength > 64) errors.name = 'teams.validation.name';
  if (tagLength > 8) errors.tag = 'teams.validation.tag';
  if (
    url &&
    (!/^https?:\/\/[^\s]+$/i.test(url) ||
      new TextEncoder().encode(url).length > 2048)
  ) {
    errors.picture_url = 'teams.validation.picture';
  }
  return errors;
}

export function changedTeamFields(
  original: TeamValues,
  next: TeamValues,
): TeamChanges {
  const changes: TeamChanges = {};
  if (original.name !== next.name.trim()) changes.name = next.name.trim();
  if (original.tag !== next.tag.trim()) changes.tag = next.tag.trim();
  if (original.picture_url !== next.picture_url.trim())
    changes.picture_url = next.picture_url.trim();
  return changes;
}
