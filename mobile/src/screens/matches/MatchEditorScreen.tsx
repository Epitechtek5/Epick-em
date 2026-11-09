import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from '@/i18n';
import { useAuth } from '@/features/auth/session';
import { matchApi } from '@/features/matches/api';
import { useMatchContext, type MatchContext } from '@/features/matches/context';
import { useMatchAction } from '@/features/matches/use-match-action';
import { brackets, type Bracket } from '@/features/matches/types';
import { elimination, scheduleProblem } from '@/features/matches/validation';
import { MatchPage, MatchState } from '@/components/matches/MatchPage';
import { StepOptionSelect } from '@/components/steps/option-select';
import { TournamentDateField } from '@/components/tournaments/date-field';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Input } from '@/components/ui/input';
import { ScreenState, FormMessage } from '@/components/ui/feedback';

export default function MatchEditorScreen() {
  const { t } = useTranslation();
  const { user, token } = useAuth();
  const state = useMatchContext();

  if (!state.data) return <MatchState {...state} />;

  const { step, match } = state.data;
  if (
    !token ||
    user?.role !== 'admin' ||
    step.status !== 'ongoing' ||
    (match && !['scheduled', 'ongoing'].includes(match.status))
  ) {
    return <ScreenState message={t('errors.forbidden')} />;
  }

  return (
    <ScheduleForm key={match?.id ?? step.id} token={token} data={state.data} />
  );
}

function ScheduleForm({ data, token }: { data: MatchContext; token: string }) {
  const { t } = useTranslation();
  const { step, match, groups } = data;
  const [group, setGroup] = useState(
    match ? (match.group_id ?? '') : (groups[0]?.group_id ?? ''),
  );
  const [round, setRound] = useState(match?.round?.toString() ?? '');
  const [bracket, setBracket] = useState<Bracket | ''>(match?.bracket ?? '');
  const [next, setNext] = useState(match?.next_match_id ?? '');
  const [date, setDate] = useState(match?.scheduled_at ?? null);
  const [ids, setIds] = useState(
    match?.participants.map((participant) => participant.participant_id) ?? [],
  );
  const [search, setSearch] = useState('');
  const action = useMatchAction();

  const editableParticipants =
    (!match || match.status === 'scheduled') && !!group;
  const groupMembers =
    groups.find((item) => item.group_id === group)?.participants ?? [];
  const nextOptions = data.matches.filter((item) => item.id !== match?.id);

  function save() {
    const input = {
      group_id: group,
      round: round.trim() ? Number(round) : null,
      bracket: bracket || null,
      next_match_id: next || null,
      scheduled_at: date,
      participant_ids: ids,
    };

    const problem = scheduleProblem(
      input,
      step,
      groups,
      data.matches,
      match ?? undefined,
    );
    if (problem) {
      action.setError('matches.validation.' + problem);
      return;
    }

    const api = matchApi(token, step.tournament_id, step.id);
    void action.run(async () => {
      if (match) {
        const participantChanged =
          editableParticipants &&
          (ids.length !== match.participants.length ||
            ids.some(
              (id) =>
                !match.participants.some(
                  (participant) => participant.participant_id === id,
                ),
            ));
        const changes = {
          ...(input.round !== match.round && { round: input.round }),
          ...(input.bracket !== match.bracket && { bracket: input.bracket }),
          ...(input.next_match_id !== match.next_match_id && {
            next_match_id: input.next_match_id,
          }),
          ...(date !== match.scheduled_at && { scheduled_at: date }),
          ...(participantChanged && { participant_ids: ids }),
        };

        if (Object.keys(changes).length > 0) {
          await api.update(match.id, changes);
        }
        router.back();
        return;
      }

      const created = await api.create(input);
      router.replace({
        pathname:
          '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]/matches/[matchId]',
        params: {
          tournamentId: step.tournament_id,
          stepId: step.id,
          matchId: created.id,
        },
      });
    });
  }

  return (
    <MatchPage>
      <View className="gap-4 rounded-xl border border-border bg-card p-4">
        <Text className="text-lg font-semibold">{t('matches.detail')}</Text>

        <StepOptionSelect
          label={t('matches.group')}
          disabled={!!match}
          value={group}
          options={groups.map((item) => item.group_id)}
          labelFor={(id) =>
            id
              ? t('steps.group', {
                  index: groups.find((item) => item.group_id === id)?.index,
                })
              : t('matches.unset')
          }
          onSelect={(id) => {
            setGroup(id);
            setIds([]);
          }}
        />

        <View className="gap-2">
          <Text className="font-medium">{t('matches.round')}</Text>
          <Input
            accessibilityLabel={t('matches.round')}
            keyboardType="number-pad"
            value={round}
            onChangeText={setRound}
          />
        </View>

        {step.format === 'double_elim' ? (
          <StepOptionSelect
            label={t('matches.bracket')}
            value={bracket}
            options={['', ...brackets]}
            labelFor={(value) =>
              value ? t('matches.region.' + value) : t('matches.unset')
            }
            onSelect={setBracket}
          />
        ) : null}

        {elimination(step) ? (
          <View className="gap-2">
            <StepOptionSelect
              label={t('matches.next')}
              value={next}
              options={['', ...nextOptions.map((item) => item.id)]}
              labelFor={(id) =>
                id
                  ? t('matches.number', {
                      number:
                        data.matches.findIndex((item) => item.id === id) + 1,
                    })
                  : t('matches.noNext')
              }
              onSelect={setNext}
            />
            <Text variant="muted">{t('matches.nextHelp')}</Text>
          </View>
        ) : null}

        <TournamentDateField
          label={t('matches.date')}
          value={date}
          onChange={setDate}
          optional
        />
      </View>

      {editableParticipants ? (
        <View className="gap-3 rounded-xl border border-border bg-card p-4">
          <Text className="text-lg font-semibold">
            {t('matches.participants')}
          </Text>
          <Input
            accessibilityLabel={t('matches.search')}
            placeholder={t('matches.search')}
            value={search}
            onChangeText={setSearch}
          />
          {groupMembers
            .filter((participant) => {
              const name =
                data.names[participant.participant_id] ??
                t('steps.unknownParticipant');
              return name
                .toLocaleLowerCase()
                .includes(search.trim().toLocaleLowerCase());
            })
            .map((participant) => {
              const id = participant.participant_id;
              const selected = ids.includes(id);
              return (
                <Button
                  key={id}
                  role="checkbox"
                  accessibilityState={{ checked: selected }}
                  variant={selected ? 'secondary' : 'outline'}
                  onPress={() =>
                    setIds((previous) =>
                      selected
                        ? previous.filter((item) => item !== id)
                        : [...previous, id],
                    )
                  }
                >
                  <Text>
                    {selected ? '✓ ' : ''}
                    {data.names[id] ?? t('steps.unknownParticipant')}
                  </Text>
                </Button>
              );
            })}
        </View>
      ) : null}

      {action.error ? <FormMessage>{t(action.error)}</FormMessage> : null}
      <Button disabled={action.busy} onPress={save}>
        <Text>{t('common.save')}</Text>
      </Button>
    </MatchPage>
  );
}
