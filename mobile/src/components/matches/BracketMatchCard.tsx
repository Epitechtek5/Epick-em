import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/i18n';
import {
  bracketCardHeight,
  bracketCardWidth,
} from '@/features/matches/bracket';
import type { MatchContext } from '@/features/matches/context';
import type { Match } from '@/features/matches/types';
import { matchNumber } from './MatchCard';

interface BracketParticipant {
  key: string;
  name: string;
  score: string;
  winner: boolean;
  placeholder: boolean;
}

function winnerId(match: Match) {
  return match.participants.find(
    (participant) => participant.result === 'win' || participant.rank === 1,
  )?.participant_id;
}

function bracketParticipants(
  match: Match,
  context: MatchContext,
  t: ReturnType<typeof useTranslation>['t'],
): BracketParticipant[] {
  const participants = [...match.participants]
    .sort((left, right) => (left.rank ?? Infinity) - (right.rank ?? Infinity))
    .slice(0, 2)
    .map((participant) => {
      const winner =
        participant.result === 'win' ||
        (participant.rank === 1 && match.status === 'finished');
      const hasScore =
        match.status === 'finished' ||
        participant.points !== 0 ||
        participant.rank !== null ||
        participant.result !== null;

      return {
        key: participant.participant_id,
        name:
          context.names[participant.participant_id] ??
          t('steps.unknownParticipant'),
        score: hasScore ? String(participant.points) : '—',
        winner,
        placeholder: false,
      };
    });

  const resolvedIds = new Set(
    match.participants.map((item) => item.participant_id),
  );
  const predecessors = context.matches
    .filter((candidate) => candidate.next_match_id === match.id)
    .sort(
      (left, right) =>
        (matchNumber(context.matches, left.id) ?? Infinity) -
        (matchNumber(context.matches, right.id) ?? Infinity),
    )
    .filter((candidate) => {
      const id = winnerId(candidate);
      return !id || !resolvedIds.has(id);
    });

  while (participants.length < 2) {
    const predecessor = predecessors.shift();
    const number = predecessor
      ? matchNumber(context.matches, predecessor.id)
      : null;
    participants.push({
      key: `placeholder-${participants.length}`,
      name:
        number !== null
          ? t('matches.winnerOf', { number })
          : t('matches.toBeDetermined'),
      score: '—',
      winner: false,
      placeholder: true,
    });
  }

  return participants;
}

export function BracketMatchCard({
  match,
  context,
  onPress,
}: {
  match: Match;
  context: MatchContext;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const number = matchNumber(context.matches, match.id);
  const participants = bracketParticipants(match, context, t);
  const title = number ? t('matches.number', { number }) : t('matches.detail');
  const participantSummary = participants
    .map((participant) =>
      participant.winner
        ? `${participant.name}, ${t('matches.winner')}, ${participant.score}`
        : `${participant.name}, ${participant.score}`,
    )
    .join('. ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${t(
        `matches.status.${match.status}`,
      )}. ${participantSummary}`}
      accessibilityHint={t('matches.openDetails')}
      className="overflow-hidden rounded-lg border border-border bg-card active:bg-accent"
      style={{ width: bracketCardWidth, height: bracketCardHeight }}
      onPress={onPress}
    >
      <View className="h-8 flex-row items-center justify-between border-b border-border bg-muted px-2.5">
        <Text variant="small" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="muted" numberOfLines={1}>
          {t(`matches.status.${match.status}`)}
        </Text>
      </View>
      {participants.map((participant, index) => (
        <View
          key={participant.key}
          className={`min-h-0 flex-1 flex-row items-center gap-2 px-2.5 ${
            index === 0 ? 'border-b border-border' : ''
          }`}
          accessibilityLabel={
            participant.winner
              ? `${participant.name}, ${t('matches.winner')}, ${participant.score}`
              : `${participant.name}, ${participant.score}`
          }
        >
          <Text
            className={`min-w-0 flex-1 ${
              participant.winner ? 'font-semibold' : ''
            } ${participant.placeholder ? 'text-muted-foreground' : ''}`}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {participant.name}
          </Text>
          <Text className={participant.winner ? 'font-semibold' : ''}>
            {participant.score}
            {participant.winner ? ' ★' : ''}
          </Text>
        </View>
      ))}
    </Pressable>
  );
}
