import { useTournamentSource } from '@/features/tournaments/source-context';
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
  seed?: number | null;
}

function winnerId(match: Match) {
  return match.participants.find(
    (participant) => participant.result === 'win' || participant.rank === 1,
  )?.participant_id;
}

function bracketParticipants(
  match: Match,
  context: Pick<MatchContext, 'matches' | 'names'> &
    Partial<Pick<MatchContext, 'groups'>>,
  t: ReturnType<typeof useTranslation>['t'],
  external: boolean,
): BracketParticipant[] {
  const participants: BracketParticipant[] = [...match.participants]
    .sort(
      (left, right) =>
        (left.slot ?? left.rank ?? Infinity) -
        (right.slot ?? right.rank ?? Infinity),
    )
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
        seed: context.groups
          ?.flatMap((g) => g.participants)
          .find((p) => p.participant_id === participant.participant_id)?.seed,
        name:
          context.names[participant.participant_id] ??
          t('steps.unknownParticipant'),
        score: external
          ? 'score' in participant.stats &&
            typeof participant.stats.score === 'number'
            ? String(participant.stats.score)
            : '—'
          : hasScore
            ? String(participant.games_won ?? participant.points)
            : '—',
        winner,
        placeholder: false,
      };
    });

  const resolvedIds = new Set(
    match.participants.map((item) => item.participant_id),
  );
  const predecessors = context.matches
    .filter(
      (candidate) =>
        candidate.next_match_id === match.id ||
        candidate.loser_next_match_id === match.id,
    )
    .sort(
      (left, right) =>
        (matchNumber(context.matches, left.id) ?? Infinity) -
        (matchNumber(context.matches, right.id) ?? Infinity),
    )
    .filter((candidate) => {
      const id =
        candidate.loser_next_match_id === match.id
          ? candidate.participants.find((p) => p.result === 'loss')
              ?.participant_id
          : winnerId(candidate);
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
          ? t(
              predecessor?.loser_next_match_id === match.id
                ? 'matches.loserOf'
                : 'matches.winnerOf',
              { number },
            )
          : match.status === 'finished' && match.participants.length === 1
            ? t('steps.advanced.bye')
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
  context: Pick<MatchContext, 'matches' | 'names'> &
    Partial<Pick<MatchContext, 'groups'>>;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const source = useTournamentSource();
  const number = matchNumber(context.matches, match.id);
  const participants = bracketParticipants(match, context, t, Boolean(source));
  const reset =
    match.bracket === 'grand_final' &&
    context.matches.some(
      (m) => m.next_match_id === match.id && m.loser_next_match_id === match.id,
    );
  const title = reset
    ? t('steps.advanced.finalReset')
    : number
      ? t('matches.number', { number })
      : t('matches.detail');
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
            {participant.seed ? `#${participant.seed} ` : ''}
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
