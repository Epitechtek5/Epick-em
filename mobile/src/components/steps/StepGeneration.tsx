import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormMessage } from '@/components/ui/feedback';
import { Text } from '@/components/ui/text';
import {
  generateMatches,
  generateNextRound,
  previewGeneration,
  type GenerationPreview,
} from '@/features/steps/api';
import { stepErrorKey } from '@/features/steps/errors';
import type { TournamentStep } from '@/features/steps/types';
import type { Match } from '@/features/matches/types';
import { useTranslation } from '@/i18n';

export function StepGeneration({
  token,
  step,
  matches,
  names,
  onChanged,
}: {
  token: string;
  step: TournamentStep;
  matches: Match[];
  names: Record<string, string>;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<GenerationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canGenerateRound =
    step.format === 'swiss' &&
    matches.length > 0 &&
    matches.every((match) =>
      ['finished', 'cancelled'].includes(match.status),
    ) &&
    Math.max(...matches.map((match) => match.round ?? 0)) <
      step.matches_per_group;

  async function run(operation: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (caught) {
      setPreview(null);
      setError(stepErrorKey(caught));
    } finally {
      setBusy(false);
    }
  }

  async function nextRound(allowRematches: boolean) {
    await generateNextRound(token, step.tournament_id, step.id, allowRematches);
    await onChanged();
  }

  if (step.status !== 'ongoing') return null;
  return (
    <Card>
      <CardContent className="gap-3 pt-5">
        <Text className="font-semibold">{t('steps.advanced.generation')}</Text>
        {error ? <FormMessage>{t(error)}</FormMessage> : null}
        {!matches.length ? (
          <>
            <Button
              variant="outline"
              disabled={busy}
              onPress={() =>
                void run(async () =>
                  setPreview(
                    await previewGeneration(token, step.tournament_id, step.id),
                  ),
                )
              }
            >
              <Text>{t('steps.advanced.preview')}</Text>
            </Button>
            {preview ? (
              <View className="gap-3">
                <Text variant="muted">{t('steps.advanced.previewHelp')}</Text>
                {preview.matches.map((match, index) => (
                  <View
                    key={index}
                    className="gap-1 rounded-lg border border-border p-3"
                  >
                    <Text className="font-medium">
                      {t('steps.advanced.plannedMatch', {
                        round: match.round,
                        number: match.number,
                      })}{' '}
                      · BO{match.best_of}
                    </Text>
                    {match.bracket ? (
                      <Text variant="muted">
                        {t(`matches.region.${match.bracket}`)}
                      </Text>
                    ) : null}
                    {match.participants.map(([id]) => (
                      <Text key={id}>
                        {names[id] ?? t('steps.unknownParticipant')}
                      </Text>
                    ))}
                    {!match.participants.length ||
                    (match.participants.length === 1 &&
                      match.bye_points === null) ? (
                      <Text variant="muted">
                        {t('steps.advanced.awaitingWinner')}
                      </Text>
                    ) : null}
                    {match.bye_points !== null ? (
                      <Text>{t('steps.advanced.bye')}</Text>
                    ) : null}
                  </View>
                ))}
                <Button
                  disabled={busy}
                  onPress={() =>
                    Alert.alert(
                      t('steps.advanced.confirmGeneration'),
                      t('steps.advanced.previewHelp'),
                      [
                        { text: t('common.cancel'), style: 'cancel' },
                        {
                          text: t('common.confirm'),
                          onPress: () =>
                            void run(async () => {
                              await generateMatches(
                                token,
                                step.tournament_id,
                                step.id,
                                preview.revision,
                              );
                              setPreview(null);
                              await onChanged();
                            }),
                        },
                      ],
                    )
                  }
                >
                  <Text>{t('steps.advanced.confirmGeneration')}</Text>
                </Button>
              </View>
            ) : null}
          </>
        ) : step.format === 'swiss' ? (
          <>
            <Button
              disabled={busy || !canGenerateRound}
              onPress={() => void run(() => nextRound(false))}
            >
              <Text>{t('steps.advanced.nextRound')}</Text>
            </Button>
            {!canGenerateRound ? (
              <Text variant="muted">{t('steps.advanced.roundPending')}</Text>
            ) : null}
            {error === 'steps.advanced.pairingError' ? (
              <Button
                variant="outline"
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    t('steps.advanced.allowRematches'),
                    t('steps.advanced.rematchHelp'),
                    [
                      { text: t('common.cancel'), style: 'cancel' },
                      {
                        text: t('common.confirm'),
                        onPress: () => void run(() => nextRound(true)),
                      },
                    ],
                  )
                }
              >
                <Text>{t('steps.advanced.allowRematches')}</Text>
              </Button>
            ) : null}
          </>
        ) : (
          <Text variant="muted">{t('steps.advanced.alreadyGenerated')}</Text>
        )}
      </CardContent>
    </Card>
  );
}
