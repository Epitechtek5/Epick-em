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

export function MatchScoreboard({
  match,
  data,
}: {
  match: Match;
  data: MatchContext;
}) {
  const { t, i18n } = useTranslation();
  const number = matchNumber(data.matches, match.id);
  const group = data.groups.find((item) => item.group_id === match.group_id);
  const metadata = [
    group && t('steps.group', { index: group.index }),
    match.round && t('matches.roundNumber', { round: match.round }),
    match.bracket && t('matches.region.' + match.bracket),
  ].filter(Boolean);
  return (
    <View className="gap-3 rounded-xl border border-border bg-card p-4">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="text-xl font-semibold">
          {number ? t('matches.number', { number }) : t('matches.detail')}
        </Text>
        <StatusBadge
          status={match.status}
          label={t('matches.status.' + match.status)}
        />
      </View>
      {metadata.length > 0 && (
        <Text variant="muted">{metadata.join(' · ')}</Text>
      )}
      {match.scheduled_at && (
        <Text variant="muted">
          {formatTournamentDate(match.scheduled_at, i18n.language)}
        </Text>
      )}
      {[...match.participants]
        .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))
        .map((p) => {
          const hasScore =
            p.rank !== null ||
            p.result !== null ||
            p.points !== 0 ||
            Object.keys(p.stats).length > 0 ||
            match.status === 'finished';
          return (
            <View
              key={p.participant_id}
              className="flex-row items-center justify-between gap-3 border-t border-border pt-3"
            >
              <View className="min-w-0 flex-1 gap-1">
                <Text className="font-semibold">
                  {p.rank ? '#' + p.rank + '  ' : ''}
                  {data.names[p.participant_id] ??
                    t('steps.unknownParticipant')}
                </Text>
                {p.result && (
                  <Text
                    className={
                      p.result === 'win'
                        ? 'text-primary'
                        : 'text-muted-foreground'
                    }
                  >
                    {t('matches.outcome.' + p.result)}
                  </Text>
                )}
              </View>
              <Text
                className="shrink text-right"
                variant={hasScore ? 'default' : 'muted'}
              >
                {hasScore
                  ? t('steps.points', { points: p.points })
                  : t('matches.noResults')}
              </Text>
            </View>
          );
        })}
      {Array.from(
        { length: Math.max(0, 2 - match.participants.length) },
        (_, i) => (
          <Text key={i} variant="muted">
            {t('matches.awaiting')}
          </Text>
        ),
      )}
    </View>
  );
}
function StatLine({ values, data }: { values: FlatStats; data: MatchContext }) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {Object.entries(values).map(([key, value]) => {
        const definition = data.statDefinitions.find((s) => s.key === key);
        return (
          <View
            key={key}
            className="min-w-20 grow gap-1 rounded-md bg-muted px-3 py-2"
          >
            <Text variant="muted">
              {definition?.name ?? key.replaceAll('_', ' ')}
            </Text>
            <Text className="font-semibold">
              {value}
              {definition?.type === 'percent' ? ' %' : ''}
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
      <Text className="font-semibold">
        {data.names[score.participant_id] ?? t('steps.unknownParticipant')}
      </Text>
      <Text variant="muted">
        {t(players.length ? 'matches.teamTotals' : 'matches.stats')}
      </Text>
      <StatLine values={total} data={data} />
      {players.length > 0 && (
        <Button
          variant="outline"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(!expanded)}
        >
          <Text>
            {t(expanded ? 'matches.hidePlayers' : 'matches.showPlayers', {
              count: players.length,
            })}
          </Text>
        </Button>
      )}
      {expanded &&
        players.map(([id, values]) => (
          <View key={id} className="gap-2 border-t border-border pt-2">
            <Text className="font-medium">
              {data.playerNames[id] ?? t('steps.unknownParticipant')}
            </Text>
            <StatLine values={values} data={data} />
          </View>
        ))}
    </View>
  );
}
