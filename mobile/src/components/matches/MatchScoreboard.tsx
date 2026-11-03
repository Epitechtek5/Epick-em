import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { useTranslation } from '@/i18n';
import type { MatchContext } from '@/features/matches/context';
import type { FlatStats, Match } from '@/features/matches/types';
import { detailed } from '@/features/matches/validation';
import { formatTournamentDate } from '@/features/tournaments/presentation';
import { matchNumber } from './MatchCard';

export function MatchScoreboard({ match, data }: { match: Match; data: MatchContext }) {
  const { t, i18n } = useTranslation();
  const number = matchNumber(data.matches, match.id);
  const group = data.groups.find((item) => item.group_id === match.group_id);
  const metadata = [
    group && t('steps.group', { index: group.index }),
    match.round && t('matches.roundNumber', { round: match.round }),
    match.bracket && t('matches.region.' + match.bracket),
  ].filter(Boolean);
  const participants = [...match.participants].sort(
    (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity),
  );

  return (
    <View className="gap-4 rounded-xl border border-border bg-card p-4">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="text-lg font-semibold">
          {number ? t('matches.number', { number }) : t('matches.detail')}
        </Text>
        <StatusBadge status={match.status} label={t('matches.status.' + match.status)} />
      </View>

      {metadata.length > 0 ? (
        <Text variant="muted">{metadata.join(' · ')}</Text>
      ) : null}

      {match.scheduled_at ? (
        <Text variant="muted">{formatTournamentDate(match.scheduled_at, i18n.language)}</Text>
      ) : null}

      <View className="overflow-hidden rounded-lg border border-border">
        {participants.map((participant, index) => {
          const hasResult =
            participant.rank !== null ||
            participant.result !== null ||
            participant.points !== 0 ||
            Object.keys(participant.stats).length > 0 ||
            match.status === 'finished';

          return (
            <View
              key={participant.participant_id}
              className={[
                'flex-row items-center justify-between gap-3 px-3 py-4',
                index > 0 ? 'border-t border-border' : '',
                participant.result === 'win' ? 'bg-primary/5' : '',
              ].join(' ')}
            >
              <View className="min-w-0 flex-1 gap-1">
                <Text className="font-semibold">
                  {participant.rank !== null ? `#${participant.rank}  ` : ''}
                  {data.names[participant.participant_id] ?? t('steps.unknownParticipant')}
                </Text>
                {participant.result ? (
                  <Text variant="muted">{t('matches.outcome.' + participant.result)}</Text>
                ) : null}
              </View>

              <Text className="shrink-0 text-right font-semibold" variant={hasResult ? 'default' : 'muted'}>
                {hasResult
                  ? t('steps.points', { points: participant.points })
                  : t('matches.noResults')}
              </Text>
            </View>
          );
        })}

        {match.participants.length === 0 ? (
          <View className="p-4">
            <Text variant="muted">{t('matches.awaiting')}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function StatLine({ values, data }: { values: FlatStats; data: MatchContext }) {
  const entries = Object.entries(values);
  if (!entries.length) return null;

  return (
    <View className="flex-row flex-wrap gap-2">
      {entries.map(([key, value]) => {
        const definition = data.statDefinitions.find((stat) => stat.key === key);
        return (
          <View key={key} className="min-w-24 grow gap-1 rounded-lg bg-muted px-3 py-2">
            <Text variant="muted">{definition?.name ?? key.replaceAll('_', ' ')}</Text>
            <Text className="text-base font-semibold">
              {value}{definition?.type === 'percent' ? ' %' : ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function ParticipantStats({
  score,
  data,
}: {
  score: Match['participants'][number];
  data: MatchContext;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const total = detailed(score.stats) ? score.stats.total : score.stats;
  const players = detailed(score.stats)
    ? Object.entries(score.stats.players ?? {})
    : [];

  if (!Object.keys(total).length && !players.length) return null;

  return (
    <View className="gap-3 rounded-xl border border-border bg-card p-4">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="text-base font-semibold">
          {data.names[score.participant_id] ?? t('steps.unknownParticipant')}
        </Text>
        {score.result ? <StatusBadge status={score.result} label={t('matches.outcome.' + score.result)} /> : null}
      </View>

      <Text variant="muted">{t(players.length ? 'matches.teamTotals' : 'matches.stats')}</Text>
      <StatLine values={total} data={data} />

      {players.length > 0 ? (
        <Button
          variant="outline"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(!expanded)}
        >
          <Text>
            {t(expanded ? 'matches.hidePlayers' : 'matches.showPlayers', { count: players.length })}
          </Text>
        </Button>
      ) : null}

      {expanded ? players.map(([id, values]) => (
        <View key={id} className="gap-2 border-t border-border pt-3">
          <Text className="font-medium">
            {data.playerNames[id] ?? t('steps.unknownParticipant')}
          </Text>
          <StatLine values={values} data={data} />
        </View>
      )) : null}
    </View>
  );
}
