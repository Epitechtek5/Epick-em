import { authenticatedRequest } from '@/lib/api';
import { authenticatedHeaders } from '@/features/users/api';
import { teamId } from '@/features/teams/validation';
import type {
  CloseStepResult,
  StepChanges,
  StepGroupRanking,
  StepInput,
  TournamentStep,
} from './types';

function stepsPath(tournamentId: string) {
  return `/tournaments/${teamId(tournamentId)}/steps`;
}

function stepPath(tournamentId: string, stepId: string) {
  return `${stepsPath(tournamentId)}/${teamId(stepId)}`;
}

export function listSteps(token: string, tournamentId: string) {
  return authenticatedRequest<TournamentStep[]>(stepsPath(tournamentId), {
    headers: authenticatedHeaders(token),
  });
}

export function getStep(token: string, tournamentId: string, stepId: string) {
  return authenticatedRequest<TournamentStep>(stepPath(tournamentId, stepId), {
    headers: authenticatedHeaders(token),
  });
}

export function createStep(
  token: string,
  tournamentId: string,
  input: StepInput,
) {
  return authenticatedRequest<TournamentStep>(stepsPath(tournamentId), {
    method: 'POST',
    headers: authenticatedHeaders(token),
    body: JSON.stringify(input),
  });
}

export function updateStep(
  token: string,
  tournamentId: string,
  stepId: string,
  changes: StepChanges,
) {
  return authenticatedRequest<TournamentStep>(stepPath(tournamentId, stepId), {
    method: 'PATCH',
    headers: authenticatedHeaders(token),
    body: JSON.stringify(changes),
  });
}

export function deleteStep(
  token: string,
  tournamentId: string,
  stepId: string,
) {
  return authenticatedRequest<void>(stepPath(tournamentId, stepId), {
    method: 'DELETE',
    headers: authenticatedHeaders(token),
  });
}

export function getStepRanking(
  token: string,
  tournamentId: string,
  stepId: string,
) {
  return authenticatedRequest<StepGroupRanking[]>(
    `${stepPath(tournamentId, stepId)}/ranking`,
    { headers: authenticatedHeaders(token) },
  );
}

export function startStep(
  token: string,
  tournamentId: string,
  stepId: string,
  seedOrder?: string[],
) {
  return authenticatedRequest<TournamentStep>(
    `${stepPath(tournamentId, stepId)}/start`,
    {
      method: 'POST',
      body: JSON.stringify(seedOrder ? { seed_order: seedOrder } : {}),
      headers: authenticatedHeaders(token),
    },
  );
}

export function closeStep(token: string, tournamentId: string, stepId: string) {
  return authenticatedRequest<CloseStepResult>(
    `${stepPath(tournamentId, stepId)}/close`,
    {
      method: 'POST',
      headers: authenticatedHeaders(token),
    },
  );
}

export interface PlannedMatch {
  group_id: string;
  round: number;
  number: number;
  bracket: import('@/features/matches/types').Bracket | null;
  best_of: number;
  participants: [string, number | null][];
  next: [number, number] | null;
  loser_next: [number, number] | null;
  bye_points: number | null;
}

export interface GenerationPreview {
  revision: string;
  matches: PlannedMatch[];
}

export function previewGeneration(
  token: string,
  tournamentId: string,
  stepId: string,
) {
  return authenticatedRequest<GenerationPreview>(
    `${stepPath(tournamentId, stepId)}/generation-preview`,
    { headers: authenticatedHeaders(token) },
  );
}

export function generateMatches(
  token: string,
  tournamentId: string,
  stepId: string,
  revision: string,
) {
  return authenticatedRequest<{
    matches: import('@/features/matches/types').Match[];
  }>(`${stepPath(tournamentId, stepId)}/generate`, {
    method: 'POST',
    headers: authenticatedHeaders(token),
    body: JSON.stringify({ revision }),
  });
}

export function generateNextRound(
  token: string,
  tournamentId: string,
  stepId: string,
  allowRematches: boolean,
) {
  return authenticatedRequest<{
    matches: import('@/features/matches/types').Match[];
  }>(`${stepPath(tournamentId, stepId)}/rounds`, {
    method: 'POST',
    headers: authenticatedHeaders(token),
    body: JSON.stringify({ allow_rematches: allowRematches }),
  });
}
