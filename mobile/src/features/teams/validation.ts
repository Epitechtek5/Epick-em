import { ApiError } from '@/lib/api';
import { z } from 'zod';
import type { TeamChanges, TeamValues } from './types';

export const MAX_TEAM_IMPORT_BYTES = 256 * 1024;

const teamSchema = z.object({
  name: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => {
      const length = Array.from(value).length;
      return length >= 1 && length <= 64;
    }),
  tag: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => Array.from(value).length <= 8),
  picture_url: z.string(),
});

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
  const result = teamSchema.safeParse(values);
  const url = values.picture_url.trim();
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if (field === 'name') errors.name = 'teams.validation.name';
      if (field === 'tag') errors.tag = 'teams.validation.tag';
    }
  }
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
