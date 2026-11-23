import type { Stat } from '@/features/stats/types';
import type { MatchContext } from './context';
import type { FlatStats, MatchGame, GameResults } from './types';
import type { loadResultConfig } from './results';
import { detailed, numericStats, optionalRank } from './validation';

export type ResultConfig = Awaited<ReturnType<typeof loadResultConfig>>;
export type DraftValues = Record<string, string>;
export interface GameDraft {
  id: string;
  total: DraftValues;
  players: Record<string, DraftValues>;
  rank: string;
}
function strings(values: FlatStats): DraftValues {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, String(value)]),
  );
}
export function gameDraft(game: MatchGame): GameDraft[] {
  return game.participants.map((participant) => ({
    id: participant.participant_id,
    total: strings(
      detailed(participant.stats) ? participant.stats.total : participant.stats,
    ),
    players: Object.fromEntries(
      Object.entries(
        detailed(participant.stats) ? (participant.stats.players ?? {}) : {},
      ).map(([id, stats]) => [id, strings(stats)]),
    ),
    rank: participant.rank?.toString() ?? '',
  }));
}
export function mvpCandidates(
  context: MatchContext,
  config: ResultConfig,
  game: MatchGame,
) {
  return game.participants
    .flatMap((participant) => {
      const roster = config.rosters[participant.participant_id];
      if (roster !== null && roster !== undefined)
        return roster.map((member) => ({ id: member.id, name: member.name }));
      return [
        {
          id: participant.participant_id,
          name: context.names[participant.participant_id],
        },
      ];
    })
    .filter(
      (candidate, index, all) =>
        all.findIndex((item) => item.id === candidate.id) === index,
    );
}
export function buildGameResults(
  draft: GameDraft[],
  attributes: DraftValues,
  config: ResultConfig,
  allowedMvp: string[],
): GameResults {
  const definitions = config.stats.filter(
    (stat) => stat.scope !== 'match' && stat.type !== 'mvp',
  );
  const selectedAttributes: DraftValues = {};
  const mvpIds: string[] = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (!value) continue;
    const stat = config.stats.find(
      (item) =>
        item.key === key && (item.scope === 'match' || item.type === 'mvp'),
    );
    if (
      !stat ||
      (stat.type === 'mvp'
        ? !allowedMvp.includes(value)
        : !stat.options?.some((option) => option.key === value))
    ) {
      throw new Error('matchGames.invalidAttributes');
    }
    selectedAttributes[key] = value;
    if (stat.type === 'mvp') mvpIds.push(value);
  }
  const ranked = draft.filter((participant) => participant.rank.trim()).length;
  if (ranked > 0 && ranked !== draft.length)
    throw new Error('matchGames.incompleteRanks');
  return {
    attributes: selectedAttributes,
    results: draft.map((participant) => {
      const roster = config.rosters[participant.id];
      const total = numericStats(participant.total, definitions);
      const players: Record<string, FlatStats> = {};
      for (const [id, values] of Object.entries(participant.players)) {
        if (!roster?.some((member) => member.id === id))
          throw new Error('matchGames.invalidPlayer');
        players[id] = numericStats(values, definitions);
      }
      // The API requires an MVP player to appear in the team's detailed results.
      for (const id of mvpIds) {
        if (roster?.some((member) => member.id === id)) players[id] ??= {};
      }
      return {
        participant_id: participant.id,
        stats: roster ? { total, players } : total,
        rank: optionalRank(participant.rank, draft.length),
        result: null,
      };
    }),
  };
}
export function statValue(
  stat: Stat | undefined,
  value: string | number,
  names: Record<string, string>,
) {
  if (stat?.type === 'mvp') return names[String(value)];
  return (
    stat?.options?.find((option) => option.key === value)?.label ??
    String(value)
  );
}
export function canFinishGame(game: MatchGame) {
  const ranked = game.participants.filter(
    (participant) => participant.rank !== null,
  ).length;
  return (
    (ranked === 0 || ranked === game.participants.length) &&
    game.participants.length >= 2 &&
    game.participants.every(
      (participant) =>
        participant.rank !== null ||
        Object.keys(
          detailed(participant.stats)
            ? participant.stats.total
            : participant.stats,
        ).length > 0,
    )
  );
}
