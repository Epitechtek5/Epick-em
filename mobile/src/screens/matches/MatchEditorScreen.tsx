import { useState } from 'react';
import { router } from 'expo-router';
import { useTranslation } from '@/i18n';
import { useAuth } from '@/features/auth/session';
import { matchApi } from '@/features/matches/api';
import { useMatchContext, type MatchContext } from '@/features/matches/context';
import { useMatchAction } from '@/features/matches/use-match-action';
import { brackets, type Bracket } from '@/features/matches/types';
import { elimination, scheduleProblem } from '@/features/matches/validation';
import { MatchState, MatchPage } from '@/components/matches/MatchPage';
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
  )
    return <ScreenState message={t('errors.forbidden')} />;
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
    match?.participants.map((p) => p.participant_id) ?? [],
  );
  const [search, setSearch] = useState('');
  const action = useMatchAction();
  const editableMembers = (!match || match.status === 'scheduled') && !!group;
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
        const changes = {
          ...(input.round !== match.round && { round: input.round }),
          ...(input.bracket !== match.bracket && { bracket: input.bracket }),
          ...(input.next_match_id !== match.next_match_id && {
            next_match_id: input.next_match_id,
          }),
          ...(date !== match.scheduled_at && { scheduled_at: date }),
          ...(editableMembers &&
          (ids.length !== match.participants.length ||
            ids.some(
              (id) => !match.participants.some((p) => p.participant_id === id),
            ))
            ? { participant_ids: ids }
            : {}),
        };
        if (Object.keys(changes).length) await api.update(match.id, changes);
        router.back();
      } else {
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
      }
    });
  }
  return (
    <MatchPage>
      <StepOptionSelect
        label={t('matches.group')}
        disabled={!!match}
        value={group}
        options={groups.map((g) => g.group_id)}
        labelFor={(id) =>
          id
            ? t('steps.group', {
                index: groups.find((g) => g.group_id === id)?.index,
              })
            : t('matches.unset')
        }
        onSelect={(id) => {
          setGroup(id);
          setIds([]);
        }}
      />
      <Text>{t('matches.round')}</Text>
      <Input
        accessibilityLabel={t('matches.round')}
        keyboardType="number-pad"
        value={round}
        onChangeText={setRound}
      />
      {step.format === 'double_elim' && (
        <StepOptionSelect
          label={t('matches.bracket')}
          value={bracket}
          options={['', ...brackets]}
          labelFor={(b) => (b ? t('matches.region.' + b) : t('matches.unset'))}
          onSelect={setBracket}
        />
      )}
      {elimination(step) && (
        <StepOptionSelect
          label={t('matches.next')}
          description={t('matches.nextHelp')}
          value={next}
          options={[
            '',
            ...data.matches.filter((m) => m.id !== match?.id).map((m) => m.id),
          ]}
          labelFor={(id) =>
            id
              ? t('matches.number', {
                  number: data.matches.findIndex((m) => m.id === id) + 1,
                })
              : t('matches.noNext')
          }
          onSelect={setNext}
        />
      )}
      <TournamentDateField
        label={t('matches.date')}
        value={date}
        onChange={setDate}
        optional
      />
      {editableMembers && (
        <>
          <Text className="font-semibold">{t('matches.participants')}</Text>
          <Input
            accessibilityLabel={t('matches.search')}
            placeholder={t('matches.search')}
            value={search}
            onChangeText={setSearch}
          />
          {groups
            .find((g) => g.group_id === group)
            ?.participants.map((p) => {
              const id = p.participant_id;
              const name = data.names[id] ?? t('steps.unknownParticipant');
              if (
                !name
                  .toLocaleLowerCase()
                  .includes(search.trim().toLocaleLowerCase())
              )
                return null;
              const checked = ids.includes(id);
              return (
                <Button
                  key={id}
                  role="checkbox"
                  accessibilityState={{ checked }}
                  variant={checked ? 'secondary' : 'outline'}
                  onPress={() =>
                    setIds((prev) =>
                      prev.includes(id)
                        ? prev.filter((item) => item !== id)
                        : [...prev, id],
                    )
                  }
                >
                  <Text>
                    {checked ? '✓ ' : ''}
                    {name}
                  </Text>
                </Button>
              );
            })}
        </>
      )}
      {action.error && <FormMessage>{t(action.error)}</FormMessage>}
      <Button disabled={action.busy} onPress={save}>
        <Text>{t('common.save')}</Text>
      </Button>
    </MatchPage>
  );
}
