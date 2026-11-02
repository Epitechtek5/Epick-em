import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StepOptionSelect } from '@/components/steps/option-select';
import { Button } from '@/components/ui/button';
import { FormMessage, ScreenState } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/session';
import { useGameResource } from '@/features/games/use-game-resource';
import {
  createStep,
  getStep,
  listSteps,
  updateStep,
} from '@/features/steps/api';
import { stepErrorKey } from '@/features/steps/errors';
import type {
  StepFormat,
  StepInput,
  StepMatchType,
} from '@/features/steps/types';
import {
  changedStepFields,
  type StepFieldErrors,
  validateStep,
  validateStepNeighbors,
} from '@/features/steps/validation';
import { getTournament } from '@/features/tournaments/api';
import { useTranslation } from '@/i18n';

const FORMATS: readonly StepFormat[] = [
  'pool',
  'swiss',
  'single_elim',
  'double_elim',
];
const MATCH_TYPES: readonly StepMatchType[] = ['duel', 'ffa'];

export default function StepEditorScreen() {
  const { t } = useTranslation();
  const { token, user } = useAuth();
  const { tournamentId, stepId } = useLocalSearchParams<{
    tournamentId: string;
    stepId?: string;
  }>();
  const insets = useSafeAreaInsets();
  const [values, setValues] = useState<StepInput | null>(null);
  const [criterion, setCriterion] = useState('');
  const [errors, setErrors] = useState<StepFieldErrors>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    async (accessToken: string) => {
      const [tournament, steps, step] = await Promise.all([
        getTournament(accessToken, tournamentId),
        listSteps(accessToken, tournamentId),
        stepId
          ? getStep(accessToken, tournamentId, stepId)
          : Promise.resolve(null),
      ]);
      return {
        tournament,
        steps: [...steps].sort((a, b) => a.position - b.position),
        step,
      };
    },
    [stepId, tournamentId],
  );
  const resource = useGameResource(load, stepErrorKey);

  if (user?.role !== 'admin') {
    return <ScreenState error message={t('errors.forbidden')} />;
  }
  if (!resource.data) {
    return (
      <ScreenState
        loading={resource.loading}
        error={Boolean(resource.error)}
        message={t(resource.error || 'steps.loading')}
        onRetry={resource.error ? () => void resource.reload() : undefined}
      />
    );
  }
  if (!['draft', 'registration'].includes(resource.data.tournament.status)) {
    return <ScreenState error message={t('steps.errors.locked')} />;
  }

  const { tournament, steps, step } = resource.data;
  const previous = steps.at(-1);
  const defaultCapacity = previous
    ? previous.group_count * previous.advance_per_group
    : tournament.max_participants;
  const formValues: StepInput =
    values ??
    (step
      ? {
          position: step.position,
          format: step.format,
          match_type: step.match_type,
          group_count: step.group_count,
          group_size: step.group_size,
          matches_per_group: step.matches_per_group,
          advance_per_group: step.advance_per_group,
          tiebreak: step.tiebreak,
        }
      : {
          position: (previous?.position ?? 0) + 1,
          format: 'pool',
          match_type: 'duel',
          group_count: 1,
          group_size: defaultCapacity,
          matches_per_group: 1,
          advance_per_group: 1,
          tiebreak: [],
        });

  function change<K extends keyof StepInput>(field: K, value: StepInput[K]) {
    setValues({ ...formValues, [field]: value });
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function addCriterion() {
    const key = criterion.trim();
    if (
      !/^[a-z0-9_]{1,32}$/.test(key) ||
      formValues.tiebreak.includes(key) ||
      formValues.tiebreak.length >= 8
    ) {
      setErrors((current) => ({
        ...current,
        tiebreak: formValues.tiebreak.includes(key)
          ? 'steps.validation.tiebreakDuplicate'
          : 'steps.validation.tiebreak',
      }));
      return;
    }
    change('tiebreak', [...formValues.tiebreak, key]);
    setCriterion('');
  }

  function moveCriterion(index: number, offset: -1 | 1) {
    const next = [...formValues.tiebreak];
    const target = index + offset;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    change('tiebreak', next);
  }

  async function save() {
    if (!token || busy) return;
    const validation = {
      ...validateStep(formValues),
      ...validateStepNeighbors(formValues, tournament, steps, step?.id),
    };
    if (Object.keys(validation).length) {
      setErrors(validation);
      setMessage('steps.validation.form');
      return;
    }
    const changes = step ? changedStepFields(step, formValues) : null;
    if (changes && !Object.keys(changes).length) {
      setMessage('tournaments.noChanges');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const saved = step
        ? await updateStep(token, tournamentId, step.id, changes!)
        : await createStep(token, tournamentId, formValues);
      router.replace({
        pathname: '/(authenticated)/tournaments/[tournamentId]/steps/[stepId]',
        params: { tournamentId, stepId: saved.id },
      });
    } catch (caught) {
      setMessage(stepErrorKey(caught));
    } finally {
      setBusy(false);
    }
  }

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
        {message ? <FormMessage>{t(message)}</FormMessage> : null}

        <Section
          title={t('steps.editor.format')}
          description={t('steps.editor.formatHelp')}
        />
        <NumberField
          label={t('steps.fields.position')}
          value={formValues.position}
          error={errors.position}
          onChange={(value) => change('position', value)}
        />
        <StepOptionSelect
          label={t('steps.fields.format')}
          value={formValues.format}
          options={FORMATS}
          labelFor={(value) => t(`steps.format.${value}`)}
          onSelect={(value) => {
            change('format', value);
            if (value !== 'pool') change('group_count', 1);
          }}
        />
        <StepOptionSelect
          label={t('steps.fields.matchType')}
          value={formValues.match_type}
          options={MATCH_TYPES}
          labelFor={(value) => t(`steps.matchType.${value}`)}
          onSelect={(value) => change('match_type', value)}
        />

        <Section
          title={t('steps.editor.groups')}
          description={t('steps.editor.groupsHelp')}
        />
        <NumberField
          label={t('steps.fields.groupCount')}
          value={formValues.group_count}
          error={errors.group_count}
          onChange={(value) => change('group_count', value)}
          editable={formValues.format === 'pool'}
        />
        <NumberField
          label={t('steps.fields.groupSize')}
          value={formValues.group_size}
          error={errors.group_size}
          onChange={(value) => change('group_size', value)}
        />

        <Section
          title={t('steps.editor.matches')}
          description={t('steps.editor.matchesHelp')}
        />
        <NumberField
          label={t('steps.fields.matchesPerGroup')}
          value={formValues.matches_per_group}
          error={errors.matches_per_group}
          onChange={(value) => change('matches_per_group', value)}
        />

        <Section
          title={t('steps.editor.qualification')}
          description={t('steps.editor.qualificationHelp')}
        />
        <NumberField
          label={t('steps.fields.advancePerGroup')}
          value={formValues.advance_per_group}
          error={errors.advance_per_group}
          onChange={(value) => change('advance_per_group', value)}
        />
        <Text variant="muted">
          {t('steps.capacityProgression', {
            capacity: formValues.group_count * formValues.group_size,
            qualified: formValues.group_count * formValues.advance_per_group,
          })}
        </Text>

        <Section
          title={t('steps.tiebreak.title')}
          description={t('steps.tiebreak.help')}
        />
        {formValues.tiebreak.map((item, index) => (
          <View
            key={item}
            className="flex-row items-center gap-2 rounded-md border border-border p-2"
          >
            <Text className="min-w-0 flex-1">
              {index + 1}. {item}
            </Text>
            <Button
              size="sm"
              variant="outline"
              accessibilityLabel={t('steps.tiebreak.moveUp', { item })}
              disabled={index === 0}
              onPress={() => moveCriterion(index, -1)}
            >
              <Text>↑</Text>
            </Button>
            <Button
              size="sm"
              variant="outline"
              accessibilityLabel={t('steps.tiebreak.moveDown', { item })}
              disabled={index === formValues.tiebreak.length - 1}
              onPress={() => moveCriterion(index, 1)}
            >
              <Text>↓</Text>
            </Button>
            <Button
              size="sm"
              variant="outline"
              accessibilityLabel={t('steps.tiebreak.remove', { item })}
              onPress={() =>
                change(
                  'tiebreak',
                  formValues.tiebreak.filter((value) => value !== item),
                )
              }
            >
              <Text>✕</Text>
            </Button>
          </View>
        ))}
        <View className="flex-row items-center gap-2">
          <Input
            className="flex-1"
            accessibilityLabel={t('steps.tiebreak.criterion')}
            placeholder={t('steps.tiebreak.placeholder')}
            value={criterion}
            invalid={Boolean(errors.tiebreak)}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setCriterion}
          />
          <Button
            variant="outline"
            disabled={!criterion.trim() || formValues.tiebreak.length >= 8}
            onPress={addCriterion}
          >
            <Text>{t('steps.tiebreak.add')}</Text>
          </Button>
        </View>
        {errors.tiebreak ? (
          <Text className="text-sm text-destructive">{t(errors.tiebreak)}</Text>
        ) : null}
        <Text variant="muted">{t('steps.tiebreak.limitation')}</Text>

        <Button disabled={busy} onPress={() => void save()}>
          <Text>{t('common.save')}</Text>
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function NumberField({
  label,
  value,
  error,
  onChange,
  editable = true,
}: {
  label: string;
  value: number;
  error?: string;
  onChange: (value: number) => void;
  editable?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View className="gap-1">
      <Text className="font-medium">{label}</Text>
      <Input
        accessibilityLabel={label}
        value={String(value)}
        keyboardType="number-pad"
        editable={editable}
        invalid={Boolean(error)}
        onChangeText={(text) => onChange(Number(text))}
      />
      {error ? (
        <Text className="text-sm text-destructive">{t(error)}</Text>
      ) : null}
    </View>
  );
}

function Section({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <View className="gap-1 border-t border-border pt-4">
      <Text className="text-lg font-semibold">{title}</Text>
      <Text variant="muted">{description}</Text>
    </View>
  );
}
