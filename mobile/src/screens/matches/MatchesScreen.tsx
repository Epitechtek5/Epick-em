import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/features/auth/session';
import { useMatchContext } from '@/features/matches/context';
import { statuses, type MatchStatus } from '@/features/matches/types';
import { elimination } from '@/features/matches/validation';
import { MatchPage, MatchState } from '@/components/matches/MatchPage';
import { MatchCard } from '@/components/matches/MatchCard';
import { MatchBracket } from '@/components/matches/MatchBracket';
import { StepOptionSelect } from '@/components/steps/option-select';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { ScreenState } from '@/components/ui/feedback';
import { useTranslation } from '@/i18n';
export default function MatchesScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [list, setList] = useState(false);
  const [group, setGroup] = useState('');
  const [status, setStatus] = useState<MatchStatus | ''>('');
  const state = useMatchContext(group || undefined, status || undefined);
  const { data, tournamentId, stepId } = state;
  if (!data) return <MatchState {...state} />;
  const params = { tournamentId, stepId };
  const graph = elimination(data.step) && !list;
  const open = (matchId: string) =>
    router.push({
      pathname:
        '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]/matches/[matchId]',
      params: { ...params, matchId },
    });
  const sections = new Map<string, typeof data.matches>();
  const sorted = [...data.visible].sort((a, b) => {
    if (data.step.format === 'pool' && a.group_id !== b.group_id)
      return (
        (data.groups.find((g) => g.group_id === a.group_id)?.index ??
          Infinity) -
        (data.groups.find((g) => g.group_id === b.group_id)?.index ?? Infinity)
      );
    return (a.round ?? Infinity) - (b.round ?? Infinity);
  });
  for (const match of sorted) {
    const g = data.groups.find((g) => g.group_id === match.group_id);
    const heading = [
      data.step.format === 'pool' && g && t('steps.group', { index: g.index }),
      match.bracket && t('matches.region.' + match.bracket),
      match.round
        ? t('matches.roundNumber', { round: match.round })
        : t('matches.unknownRound'),
    ]
      .filter(Boolean)
      .join(' · ');
    const items = sections.get(heading) ?? [];
    items.push(match);
    sections.set(heading, items);
  }
  return (
    <MatchPage>
      {user?.role === 'admin' && data.step.status === 'ongoing' && (
        <Button
          onPress={() =>
            router.push({
              pathname:
                '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]/matches/create',
              params,
            })
          }
        >
          <Text>{t('matches.create')}</Text>
        </Button>
      )}
      {elimination(data.step) && (
        <Button
          variant="outline"
          onPress={() => {
            setList(!list);
            setGroup('');
            setStatus('');
          }}
        >
          <Text>{t(graph ? 'matches.list' : 'matches.bracket')}</Text>
        </Button>
      )}
      {!graph && (
        <>
          <StepOptionSelect
            label={t('matches.group')}
            value={group}
            options={['', ...data.groups.map((g) => g.group_id)]}
            labelFor={(id) =>
              id
                ? t('steps.group', {
                    index: data.groups.find((g) => g.group_id === id)?.index,
                  })
                : t('matches.all')
            }
            onSelect={setGroup}
          />
          <StepOptionSelect
            label={t('matches.statusLabel')}
            value={status}
            options={['', ...statuses]}
            labelFor={(value) =>
              value ? t('matches.status.' + value) : t('matches.all')
            }
            onSelect={setStatus}
          />
        </>
      )}
      {!data.visible.length ? (
        <ScreenState message={t('matches.empty')} />
      ) : null}
      {graph && data.matches.length > 0 ? (
        <>
          <Text variant="muted">{t('matches.bracketHelp')}</Text>
          <MatchBracket context={data} open={open} />
        </>
      ) : null}
      {!graph &&
        [...sections].map(([heading, items]) => (
          <View className="gap-2" key={heading}>
            <Text className="font-semibold">{heading}</Text>
            {items.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                context={data}
                onPress={() => open(match.id)}
              />
            ))}
          </View>
        ))}
      <Button
        variant="outline"
        onPress={() =>
          router.navigate({
            pathname:
              '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]',
            params,
          })
        }
      >
        <Text>{t('steps.groups')}</Text>
      </Button>
    </MatchPage>
  );
}
