import { normalizeDate } from '@/features/tournaments/validation';
import type { Stat } from '@/features/stats/types';
import type { StepGroupRanking, TournamentStep } from '@/features/steps/types';
import type { MatchInput, Match, FlatStats, TeamStats } from './types';
export function elimination(step: TournamentStep) {
  return step.format === 'single_elim' || step.format === 'double_elim';
}
export function playable(step: TournamentStep, count: number) {
  return (
    count >= 2 && count <= (step.match_type === 'duel' ? 2 : step.group_size)
  );
}
export function scheduleProblem(
  input: MatchInput,
  step: TournamentStep,
  groups: StepGroupRanking[],
  matches: Match[],
  current?: Match,
) {
  const group = groups.find((g) => g.group_id === input.group_id);
  if (!group && !(current && current.group_id === null)) return 'group';
  if (
    input.round !== null &&
    (!Number.isInteger(input.round) || input.round < 1 || input.round > 1000)
  )
    return 'round';
  if (input.bracket && step.format !== 'double_elim') return 'bracket';
  if (input.scheduled_at !== null) {
    const date = input.scheduled_at;
    const iso = normalizeDate(date);
    if (
      !iso ||
      date.slice(0, 19) !== iso.slice(0, 19) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(date)
    )
      return 'date';
  }
  if (
    input.next_match_id &&
    (!elimination(step) ||
      input.next_match_id === current?.id ||
      !matches.some((m) => m.id === input.next_match_id))
  )
    return 'next';
  const ids = input.participant_ids;
  if (
    ids.length > (step.match_type === 'duel' ? 2 : step.group_size) ||
    new Set(ids).size !== ids.length ||
    (group &&
      ids.some(
        (id) => !group.participants.some((p) => p.participant_id === id),
      ))
  )
    return 'participants';
  return null;
}
export function detailed(stats: FlatStats | TeamStats): stats is TeamStats {
  return typeof stats.total === 'object';
}
export function numericStats(
  values: Record<string, string>,
  definitions: Stat[],
): FlatStats {
  const entries = Object.entries(values).filter(
    ([, value]) => value.trim() !== '',
  );
  return Object.fromEntries(
    entries.map(([key, value]) => {
      const definition = definitions.find((stat) => stat.key === key);
      const number = Number(value.replace(',', '.'));
      if (
        !definition ||
        !Number.isFinite(number) ||
        Math.abs(number) > 1e9 ||
        (definition.type === 'percent' && (number < 0 || number > 100))
      )
        throw new Error('matches.invalidStats');
      return [key, number];
    }),
  );
}
export function optionalRank(raw: string, count: number) {
  if (!raw.trim()) return null;
  const rank = Number(raw);
  if (!Number.isInteger(rank) || rank < 1 || rank > count)
    throw new Error('matches.invalidRank');
  return rank;
}
