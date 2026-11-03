import { z } from 'zod';
import type { Tournament } from '@/features/tournaments/types';
import type { StepChanges, StepInput, TournamentStep } from './types';

const tiebreakKey = z.string().regex(/^[a-z0-9_]{1,32}$/);

const stepSchema = z
  .object({
    position: z.number().int().min(1).max(100),
    format: z.enum(['pool', 'swiss', 'single_elim', 'double_elim']),
    match_type: z.enum(['duel', 'ffa']),
    group_count: z.number().int().min(1).max(1000),
    group_size: z.number().int().min(2).max(10000),
    matches_per_group: z.number().int().min(1).max(1000),
    advance_per_group: z.number().int().min(1).max(10000),
    tiebreak: z.array(tiebreakKey).max(8),
  })
  .superRefine((step, context) => {
    if (step.advance_per_group > step.group_size) {
      context.addIssue({
        code: 'custom',
        path: ['advance_per_group'],
        message: 'steps.validation.advancePerGroup',
      });
    }
    if (step.format !== 'pool' && step.group_count !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['group_count'],
        message: 'steps.validation.singleGroup',
      });
    }
    if (step.group_count * step.group_size > 10000) {
      context.addIssue({
        code: 'custom',
        path: ['group_size'],
        message: 'steps.validation.totalCapacity',
      });
    }
    if (new Set(step.tiebreak).size !== step.tiebreak.length) {
      context.addIssue({
        code: 'custom',
        path: ['tiebreak'],
        message: 'steps.validation.tiebreakDuplicate',
      });
    }
  });

export type StepFieldErrors = Partial<Record<keyof StepInput, string>>;

const validationKeys: Record<keyof StepInput, string> = {
  position: 'steps.validation.position',
  format: 'steps.validation.format',
  match_type: 'steps.validation.matchType',
  group_count: 'steps.validation.groupCount',
  group_size: 'steps.validation.groupSize',
  matches_per_group: 'steps.validation.matchesPerGroup',
  advance_per_group: 'steps.validation.advancePerGroup',
  tiebreak: 'steps.validation.tiebreak',
};

export function validateStep(input: StepInput): StepFieldErrors {
  const result = stepSchema.safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => {
      const field = issue.path[0] as keyof StepInput;
      return [
        field,
        issue.message.startsWith('steps.')
          ? issue.message
          : validationKeys[field],
      ];
    }),
  );
}

export function validateStepNeighbors(
  input: StepInput,
  tournament: Tournament,
  steps: TournamentStep[],
  currentId?: string,
): StepFieldErrors {
  const errors: StepFieldErrors = {};
  const others = steps
    .filter((step) => step.id !== currentId)
    .sort((a, b) => a.position - b.position);
  const previous = [...others]
    .reverse()
    .find((step) => step.position < input.position);
  const next = others.find((step) => step.position > input.position);
  const expectedPosition = currentId
    ? input.position
    : (others.at(-1)?.position ?? 0) + 1;

  if (input.position !== expectedPosition) {
    errors.position = 'steps.validation.positionSequence';
  }
  const capacity = input.group_count * input.group_size;
  if (input.position === 1 && capacity !== tournament.max_participants) {
    errors.group_size = 'steps.validation.firstCapacity';
  }
  if (
    previous &&
    capacity !== previous.group_count * previous.advance_per_group
  ) {
    errors.group_size = 'steps.validation.previousCapacity';
  }
  if (
    next &&
    input.group_count * input.advance_per_group !==
      next.group_count * next.group_size
  ) {
    errors.advance_per_group = 'steps.validation.nextCapacity';
  }
  return errors;
}

export function stepChainProblems(
  tournament: Tournament,
  steps: TournamentStep[],
): string[] {
  if (!steps.length) return [];
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  const problems: string[] = [];
  if (ordered.some((step, index) => step.position !== index + 1)) {
    problems.push('steps.validation.positionSequence');
  }
  if (
    ordered[0].group_count * ordered[0].group_size !==
    tournament.max_participants
  ) {
    problems.push('steps.validation.firstCapacity');
  }
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (
      previous.group_count * previous.advance_per_group !==
      current.group_count * current.group_size
    ) {
      problems.push('steps.validation.chainCapacity');
    }
  }
  const final = ordered.at(-1)!;
  if (final.group_count * final.advance_per_group !== 1) {
    problems.push('steps.validation.finalWinner');
  }
  return [...new Set(problems)];
}

export function changedStepFields(
  step: TournamentStep,
  input: StepInput,
): StepChanges {
  const changes: StepChanges = {};
  for (const field of Object.keys(input) as (keyof StepInput)[]) {
    const current = step[field];
    const next = input[field];
    if (
      field === 'tiebreak'
        ? JSON.stringify(current) !== JSON.stringify(next)
        : current !== next
    ) {
      Object.assign(changes, { [field]: next });
    }
  }
  return changes;
}
