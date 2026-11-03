import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/i18n';
import { formatTournamentDate } from '@/features/tournaments/presentation';
import type { Match } from '@/features/matches/types';
import type { MatchContext } from '@/features/matches/context';
export function matchNumber(matches: Match[], id: string) {
  const index = matches.findIndex((m) => m.id === id);
  return index === -1 ? null : index + 1;
}
export function MatchCard({
  match,
  context,
  onPress,
}: {
  match: Match;
  context: MatchContext;
  onPress?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const group = context.groups.find((g) => g.group_id === match.group_id);
  const next =
    match.next_match_id && matchNumber(context.matches, match.next_match_id);
  const number = matchNumber(context.matches, match.id);
  const body = (
    <View className="gap-1 rounded-lg border border-border bg-card p-3">
      <Text className="font-semibold">
        {number ? t('matches.number', { number }) : t('matches.detail')} ·{' '}
        {t('matches.status.' + match.status)}
      </Text>
      <Text variant="muted">
        {[
          group && t('steps.group', { index: group.index }),
          match.round && t('matches.roundNumber', { round: match.round }),
          match.bracket && t('matches.region.' + match.bracket),
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {match.scheduled_at && (
        <Text>{formatTournamentDate(match.scheduled_at, i18n.language)}</Text>
      )}
      {[...match.participants]
        .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))
        .map((p) => (
          <Text key={p.participant_id}>
            {p.rank && '#' + p.rank + ' '}
            {context.names[p.participant_id] ?? t('steps.unknownParticipant')}
            {' · '}
            {p.result && t('matches.outcome.' + p.result) + ' · '}
            {Object.keys(p.stats).length ||
            p.points !== 0 ||
            p.rank ||
            p.result ||
            match.status === 'finished'
              ? t('steps.points', { points: p.points })
              : t('matches.noResults')}
          </Text>
        ))}
      {Array.from(
        { length: Math.max(0, 2 - match.participants.length) },
        (_, i) => (
          <Text key={i} variant="muted">
            {t('matches.awaiting')}
          </Text>
        ),
      )}
      {match.next_match_id && (
        <Text>
          {t('matches.next')}
          {' → '}
          {next ? t('matches.number', { number: next }) : t('matches.outside')}
        </Text>
      )}
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {body}
    </Pressable>
  ) : (
    body
  );
}
