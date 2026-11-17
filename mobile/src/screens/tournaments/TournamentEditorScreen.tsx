import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GameFilterSelect } from '@/components/teams/game-filter-select';
import { TournamentDateField } from '@/components/tournaments/date-field';
import { Button } from '@/components/ui/button';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/session';
import {
  createTournament,
  getTournament,
  listTournamentRoles,
  updateTournament,
} from '@/features/tournaments/api';
import { tournamentErrorKey } from '@/features/tournaments/errors';
import type {
  ParticipantType,
  RegistrationFieldType,
  RegistrationPolicy,
  TeamScoringMode,
  Tournament,
  TournamentInput,
  TournamentRoles,
  TournamentMode,
  TournamentVisibility,
} from '@/features/tournaments/types';
import {
  buildTournamentInput,
  changedTournamentFields,
  validateTournament,
} from '@/features/tournaments/validation';
import { getGame } from '@/features/games/api';
import { useGameResource } from '@/features/games/use-game-resource';
import type { Game } from '@/features/games/types';
import { useTranslation } from '@/i18n';

const EMPTY: TournamentInput = {
  game_id: '',
  name: '',
  description: null,
  start_date: '',
  end_date: '',
  registration_open_at: null,
  registration_close_at: null,
  participant_type: 'solo',
  mode: 'online',
  location: null,
  visibility: 'public',
  rules: null,
  team_min_starters: null,
  team_max_starters: null,
  team_max_substitutes: null,
  registration_policy: 'open',
  waiting_list_enabled: false,
  registration_fields: [],
  check_in_open_at: null,
  check_in_close_at: null,
  max_participants: 2,
  team_scoring_mode: 'none',
  team_scoring_n: null,
};

function Editor({
  tournament,
  roles,
}: {
  tournament?: Tournament;
  roles?: TournamentRoles;
}) {
  const { t } = useTranslation();
  const { token, user } = useAuth();
  const insets = useSafeAreaInsets();
  const [values, setValues] = useState<TournamentInput>(tournament ?? EMPTY);
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked =
    tournament?.status === 'ongoing' || tournament?.status === 'finished';
  const canEdit =
    user?.role === 'admin' ||
    (!tournament
      ? false
      : roles?.owner_id === user?.id ||
        roles?.roles.some(
          (assignment) =>
            assignment.user_id === user?.id && assignment.role === 'admin',
        ));

  const loadGame = useCallback(
    async (accessToken: string) => {
      if (!tournament) return null;
      return getGame(accessToken, tournament.game_id);
    },
    [tournament],
  );
  const gameResource = useGameResource(loadGame);
  const selectedGame = game ?? gameResource.data;

  function change<K extends keyof TournamentInput>(
    field: K,
    value: TournamentInput[K],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    if (
      !token ||
      (!tournament && user?.role !== 'admin') ||
      (tournament && !canEdit) ||
      busy
    )
      return;
    const input = buildTournamentInput(values);
    const validation = validateTournament(input);
    if (validation) {
      setError(validation);
      return;
    }
    const changes = tournament
      ? changedTournamentFields(tournament, input)
      : null;
    if (changes && !Object.keys(changes).length) {
      setError('tournaments.noChanges');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const saved = tournament
        ? await updateTournament(token, tournament.id, changes!)
        : await createTournament(token, input);
      router.replace({
        pathname: '/(authenticated)/tournaments/[tournamentId]',
        params: { tournamentId: saved.id },
      });
    } catch (caught) {
      setError(tournamentErrorKey(caught));
    } finally {
      setBusy(false);
    }
  }

  if ((!tournament && user?.role !== 'admin') || (tournament && !canEdit))
    return <ScreenState error message={t('errors.forbidden')} />;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-4 px-5 py-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        {error ? <FormMessage>{t(error)}</FormMessage> : null}
        <SectionTitle
          title={t('tournaments.editor.general')}
          description={t('tournaments.editor.generalHelp')}
        />
        {tournament ? (
          <Text variant="muted">
            {t('tournaments.fields.game')}:{' '}
            {selectedGame?.name ?? tournament.game_id}
          </Text>
        ) : (
          <GameFilterSelect
            selectedGame={selectedGame}
            includeAllGames={false}
            label={t('tournaments.fields.game')}
            onSelect={(choice) => {
              setGame(choice);
              change('game_id', choice?.id ?? '');
            }}
          />
        )}
        {tournament ? (
          <Text variant="muted">
            {t('tournaments.fields.participantType')}:{' '}
            {t(`tournaments.participantType.${values.participant_type}`)}
          </Text>
        ) : null}
        <Field
          label={t('tournaments.fields.name')}
          value={values.name}
          onChangeText={(value) => change('name', value)}
        />
        <Field
          label={t('tournaments.fields.description')}
          value={values.description ?? ''}
          onChangeText={(value) => change('description', value)}
          multiline
        />
        <Choice
          label={t('tournaments.fields.mode')}
          values={['online', 'in_person', 'hybrid'] as const}
          selected={values.mode}
          labelFor={(value) => t(`tournaments.mode.${value}`)}
          onSelect={(value: TournamentMode) => change('mode', value)}
        />
        {values.mode !== 'online' ? (
          <Field
            label={t('tournaments.fields.location')}
            value={values.location ?? ''}
            onChangeText={(value) => change('location', value || null)}
          />
        ) : null}
        <Choice
          label={t('tournaments.fields.visibility')}
          values={['public', 'invitation_only'] as const}
          selected={values.visibility}
          labelFor={(value) => t(`tournaments.visibility.${value}`)}
          onSelect={(value: TournamentVisibility) =>
            change('visibility', value)
          }
        />
        <Field
          label={t('tournaments.fields.rules')}
          value={values.rules ?? ''}
          onChangeText={(value) => change('rules', value || null)}
          multiline
        />
        <SectionTitle
          title={t('tournaments.editor.dates')}
          description={t('tournaments.editor.datesHelp')}
        />
        <TournamentDateField
          label={t('tournaments.fields.startDate')}
          value={values.start_date}
          onChange={(value) => change('start_date', value ?? '')}
        />
        <TournamentDateField
          label={t('tournaments.fields.endDate')}
          value={values.end_date}
          onChange={(value) => change('end_date', value ?? '')}
        />
        <TournamentDateField
          label={t('tournaments.fields.registrationOpen')}
          value={values.registration_open_at}
          onChange={(value) => change('registration_open_at', value)}
          optional
        />
        <SectionTitle
          title={t('tournaments.editor.participants')}
          description={t(
            `tournaments.editor.${values.participant_type}Participants`,
          )}
        />
        <TournamentDateField
          label={t('tournaments.fields.registrationClose')}
          value={values.registration_close_at}
          onChange={(value) => change('registration_close_at', value)}
          optional
        />
        <TournamentDateField
          label={t('tournaments.fields.checkInOpen')}
          value={values.check_in_open_at}
          onChange={(value) => change('check_in_open_at', value)}
          optional
        />
        <TournamentDateField
          label={t('tournaments.fields.checkInClose')}
          value={values.check_in_close_at}
          onChange={(value) => change('check_in_close_at', value)}
          optional
        />
        {!tournament ? (
          <Choice
            label={t('tournaments.fields.participantType')}
            values={['solo', 'team'] as const}
            selected={values.participant_type}
            labelFor={(value) => t(`tournaments.participantType.${value}`)}
            onSelect={(value: ParticipantType) =>
              change('participant_type', value)
            }
          />
        ) : null}
        {values.participant_type === 'team' ? (
          <View className="gap-3">
            <Field
              label={t('tournaments.fields.teamMinStarters')}
              value={String(values.team_min_starters ?? '')}
              onChangeText={(value) =>
                change('team_min_starters', value ? Number(value) : null)
              }
              keyboardType="number-pad"
              editable={!locked}
            />
            <Field
              label={t('tournaments.fields.teamMaxStarters')}
              value={String(values.team_max_starters ?? '')}
              onChangeText={(value) =>
                change('team_max_starters', value ? Number(value) : null)
              }
              keyboardType="number-pad"
              editable={!locked}
            />
            <Field
              label={t('tournaments.fields.teamMaxSubstitutes')}
              value={String(values.team_max_substitutes ?? '')}
              onChangeText={(value) =>
                change('team_max_substitutes', value ? Number(value) : null)
              }
              keyboardType="number-pad"
              editable={!locked}
            />
          </View>
        ) : null}
        <Field
          label={t('tournaments.fields.maxParticipants')}
          hint={t(
            values.participant_type === 'team'
              ? 'tournaments.editor.teamCapacityHelp'
              : 'tournaments.editor.soloCapacityHelp',
          )}
          value={String(values.max_participants)}
          onChangeText={(value) => change('max_participants', Number(value))}
          keyboardType="number-pad"
          editable={!locked}
        />
        <Choice
          label={t('tournaments.fields.registrationPolicy')}
          values={['open', 'approval_required'] as const}
          selected={values.registration_policy}
          labelFor={(value) => t(`tournaments.registrationPolicy.${value}`)}
          onSelect={(value: RegistrationPolicy) =>
            change('registration_policy', value)
          }
        />
        <Choice
          label={t('tournaments.fields.waitingList')}
          values={['enabled', 'disabled'] as const}
          selected={values.waiting_list_enabled ? 'enabled' : 'disabled'}
          labelFor={(value) => t(`common.${value}`)}
          onSelect={(value) =>
            change('waiting_list_enabled', value === 'enabled')
          }
        />
        <RegistrationFieldsEditor
          fields={values.registration_fields}
          onChange={(fields) => change('registration_fields', fields)}
        />
        {values.participant_type === 'solo' ? (
          <>
            <SectionTitle
              title={t('tournaments.editor.scoring')}
              description={t('tournaments.editor.scoringHelp')}
            />
            <Choice
              label={t('tournaments.fields.teamScoringMode')}
              values={['none', 'sum', 'best', 'top_n'] as const}
              selected={values.team_scoring_mode}
              labelFor={(value) => t(`tournaments.teamScoring.${value}`)}
              descriptionFor={(value) =>
                t(`tournaments.teamScoringHelp.${value}`)
              }
              onSelect={(value: TeamScoringMode) =>
                change('team_scoring_mode', value)
              }
              disabled={locked}
            />
            {values.team_scoring_mode === 'top_n' ? (
              <Field
                label={t('tournaments.fields.teamScoringN')}
                hint={t('tournaments.editor.topNHelp')}
                value={String(values.team_scoring_n ?? '')}
                onChangeText={(value) =>
                  change('team_scoring_n', value ? Number(value) : null)
                }
                keyboardType="number-pad"
                editable={!locked}
              />
            ) : null}
          </>
        ) : null}
        <Button disabled={busy} onPress={() => void save()}>
          <Text>{t('common.save')}</Text>
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & React.ComponentProps<typeof Input>) {
  return (
    <View className="gap-1">
      <Text className="font-medium">{label}</Text>
      {hint ? <Text variant="muted">{hint}</Text> : null}
      <Input accessibilityLabel={label} {...props} />
    </View>
  );
}

function Choice<T extends string>({
  label,
  values,
  selected,
  labelFor,
  descriptionFor,
  onSelect,
  disabled,
}: {
  label: string;
  values: readonly T[];
  selected: T;
  labelFor: (value: T) => string;
  descriptionFor?: (value: T) => string;
  onSelect: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <View className="gap-2">
      <Text className="font-medium">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {values.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={selected === value ? 'default' : 'outline'}
            disabled={disabled}
            onPress={() => onSelect(value)}
          >
            <Text>{labelFor(value)}</Text>
          </Button>
        ))}
      </View>
      {descriptionFor ? (
        <Text variant="muted">{descriptionFor(selected)}</Text>
      ) : null}
    </View>
  );
}

function RegistrationFieldsEditor({
  fields,
  onChange,
}: {
  fields: TournamentInput['registration_fields'];
  onChange: (fields: TournamentInput['registration_fields']) => void;
}) {
  const { t } = useTranslation();
  const update = (index: number, changes: Partial<(typeof fields)[number]>) =>
    onChange(
      fields.map((field, itemIndex) =>
        itemIndex === index ? { ...field, ...changes } : field,
      ),
    );

  return (
    <View className="gap-3">
      <SectionTitle
        title={t('tournaments.editor.registrationFields')}
        description={t('tournaments.editor.registrationFieldsHelp')}
      />
      {fields.map((field, index) => (
        <View
          key={`${field.key}-${index}`}
          className="gap-2 rounded-md border border-border p-3"
        >
          <Field
            label={t('tournaments.fields.fieldKey')}
            value={field.key}
            onChangeText={(value) =>
              update(index, { key: value.replace(/[^a-zA-Z0-9_]/g, '') })
            }
            autoCapitalize="none"
          />
          <Field
            label={t('tournaments.fields.fieldLabel')}
            value={field.label}
            onChangeText={(value) => update(index, { label: value })}
          />
          <Choice
            label={t('tournaments.fields.fieldType')}
            values={['text', 'number', 'select', 'boolean'] as const}
            selected={field.field_type}
            labelFor={(value) => t(`tournaments.fieldType.${value}`)}
            onSelect={(value: RegistrationFieldType) =>
              update(index, {
                field_type: value,
                options: value === 'select' ? field.options : [],
              })
            }
          />
          {field.field_type === 'select' ? (
            <Field
              label={t('tournaments.fields.fieldOptions')}
              value={field.options.join(', ')}
              onChangeText={(value) =>
                update(index, {
                  options: value
                    .split(',')
                    .map((option) => option.trim())
                    .filter(Boolean),
                })
              }
            />
          ) : null}
          <Choice
            label={t('tournaments.fields.required')}
            values={['true', 'false'] as const}
            selected={String(field.required) as 'true' | 'false'}
            labelFor={(value) => t(`common.${value}`)}
            onSelect={(value) => update(index, { required: value === 'true' })}
          />
          <Button
            variant="destructive"
            onPress={() =>
              onChange(fields.filter((_, itemIndex) => itemIndex !== index))
            }
          >
            <Text>{t('common.delete')}</Text>
          </Button>
        </View>
      ))}
      <Button
        variant="outline"
        onPress={() =>
          onChange([
            ...fields,
            {
              key: `field_${fields.length + 1}`,
              label: '',
              field_type: 'text',
              required: false,
              options: [],
            },
          ])
        }
      >
        <Text>{t('tournaments.editor.addRegistrationField')}</Text>
      </Button>
    </View>
  );
}

function SectionTitle({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <View className="gap-1 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <Text className="text-lg font-semibold">{title}</Text>
      <Text variant="muted">{description}</Text>
    </View>
  );
}

export function CreateTournamentScreen() {
  return <Editor />;
}

export function EditTournamentScreen() {
  const { t } = useTranslation();
  const { tournamentId } = useLocalSearchParams<{ tournamentId: string }>();
  const load = useCallback(
    async (token: string) => {
      const tournament = await getTournament(token, tournamentId);
      const roles = await listTournamentRoles(token, tournamentId);
      return { tournament, roles };
    },
    [tournamentId],
  );
  const { data, loading, error, reload } = useGameResource(
    load,
    tournamentErrorKey,
  );
  if (loading || error || !data)
    return (
      <ScreenState
        loading={loading}
        error={Boolean(error)}
        message={t(error || 'tournaments.loading')}
        onRetry={error ? () => void reload() : undefined}
      />
    );
  return (
    <Editor
      key={data.tournament.id}
      tournament={data.tournament}
      roles={data.roles}
    />
  );
}
