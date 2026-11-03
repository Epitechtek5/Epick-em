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

export function startStep(token: string, tournamentId: string, stepId: string) {
  return authenticatedRequest<TournamentStep>(
    `${stepPath(tournamentId, stepId)}/start`,
    {
      method: 'POST',
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
