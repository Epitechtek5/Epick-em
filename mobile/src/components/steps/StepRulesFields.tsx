import { useState } from 'react';
import { View } from 'react-native';
import { StepOptionSelect } from '@/components/steps/option-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import type { StepMatchType, StepRules } from '@/features/steps/types';
import { useTranslation } from '@/i18n';

export function StepRulesFields({
  rules,
  matchType,
  onChange,
  error,
}: {
  rules: StepRules;
  matchType: StepMatchType;
  onChange: (rules: StepRules) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const rounds = Object.entries(rules.best_of_by_round).sort(
    ([a], [b]) => Number(a) - Number(b),
  );

  function changeRound(previous: string, next: string, bestOf: 1 | 3 | 5) {
    const values = { ...rules.best_of_by_round };
    if (previous !== next && values[next] !== undefined) return;
    delete values[previous];
    values[next] = bestOf;
    onChange({ ...rules, best_of_by_round: values });
  }

  return (
    <View className="gap-4">
      {error ? <Text className="text-destructive">{t(error)}</Text> : null}
      <Card>
        <CardContent className="gap-4 pt-5">
          <Text className="text-lg font-semibold">
            {t('steps.advanced.placement')}
          </Text>
          <StepOptionSelect
            label={t('steps.advanced.seeding')}
            value={rules.seeding}
            options={['random', 'ranking', 'manual']}
            labelFor={(value) => t(`steps.advanced.seedingOptions.${value}`)}
            onSelect={(seeding) => onChange({ ...rules, seeding })}
          />
          {rules.seeding === 'manual' ? (
            <Text variant="muted">{t('steps.advanced.manualHelp')}</Text>
          ) : null}
          <StepOptionSelect
            label={t('steps.advanced.qualification')}
            value={rules.qualification}
            options={['random', 'rank', 'group_rank']}
            labelFor={(value) =>
              t(`steps.advanced.qualificationOptions.${value}`)
            }
            onSelect={(qualification) => onChange({ ...rules, qualification })}
          />
        </CardContent>
      </Card>
      {matchType === 'duel' ? (
        <Card>
          <CardContent className="gap-4 pt-5">
            <Text className="text-lg font-semibold">
              {t('steps.advanced.series')}
            </Text>
            <StepOptionSelect
              label={t('steps.advanced.defaultSeries')}
              value={String(rules.best_of)}
              options={['1', '3', '5']}
              labelFor={(value) => `BO${value}`}
              onSelect={(value) =>
                onChange({ ...rules, best_of: Number(value) as 1 | 3 | 5 })
              }
            />
            {rounds.map(([round, bestOf], index) => (
              <View key={index} className="gap-2 border-t border-border pt-3">
                <Text>{t('steps.advanced.round')}</Text>
                <Input
                  accessibilityLabel={t('steps.advanced.round')}
                  keyboardType="number-pad"
                  value={round}
                  onChangeText={(value) => changeRound(round, value, bestOf)}
                />
                <StepOptionSelect
                  label={t('steps.advanced.roundSeries', { round })}
                  value={String(bestOf)}
                  options={['1', '3', '5']}
                  labelFor={(value) => `BO${value}`}
                  onSelect={(value) =>
                    changeRound(round, round, Number(value) as 1 | 3 | 5)
                  }
                />
                <Button
                  variant="outline"
                  onPress={() => {
                    const values = { ...rules.best_of_by_round };
                    delete values[round];
                    onChange({ ...rules, best_of_by_round: values });
                  }}
                >
                  <Text>{t('common.delete')}</Text>
                </Button>
              </View>
            ))}
            <Button
              variant="outline"
              onPress={() => {
                const round = String(
                  Math.max(
                    0,
                    ...Object.keys(rules.best_of_by_round).map(Number),
                  ) + 1,
                );
                onChange({
                  ...rules,
                  best_of_by_round: {
                    ...rules.best_of_by_round,
                    [round]: rules.best_of,
                  },
                });
              }}
            >
              <Text>{t('steps.advanced.addRound')}</Text>
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardContent className="gap-4 pt-5">
          <Text className="text-lg font-semibold">
            {t('steps.advanced.scoring')}
          </Text>
          <Text variant="muted">{t('steps.advanced.scoringHelp')}</Text>
          <Button
            variant="outline"
            onPress={() =>
              onChange({
                ...rules,
                scoring: rules.scoring
                  ? null
                  : { win: 3, draw: 1, loss: 0, placement: [] },
              })
            }
          >
            <Text>
              {t(
                rules.scoring
                  ? 'steps.advanced.useTournamentScoring'
                  : 'steps.advanced.customScoring',
              )}
            </Text>
          </Button>
          {rules.scoring ? (
            <>
              {(['win', 'draw', 'loss'] as const).map((key) => (
                <View key={key} className="gap-2">
                  <Text>{t(`steps.advanced.points.${key}`)}</Text>
                  <RuleNumberInput
                    accessibilityLabel={t(`steps.advanced.points.${key}`)}
                    keyboardType="numbers-and-punctuation"
                    value={rules.scoring![key]}
                    onNumberChange={(number) =>
                      onChange({
                        ...rules,
                        scoring: {
                          ...rules.scoring!,
                          [key]: number,
                        },
                      })
                    }
                  />
                </View>
              ))}
              {matchType === 'ffa' ? (
                <View className="gap-2">
                  <Text>{t('steps.advanced.placementPoints')}</Text>
                  {rules.scoring.placement.map((points, index) => (
                    <RuleNumberInput
                      key={index}
                      accessibilityLabel={t('steps.advanced.rankPoints', {
                        rank: index + 1,
                      })}
                      keyboardType="numbers-and-punctuation"
                      value={points}
                      onNumberChange={(number) =>
                        onChange({
                          ...rules,
                          scoring: {
                            ...rules.scoring!,
                            placement: rules.scoring!.placement.map(
                              (value, i) => (i === index ? number : value),
                            ),
                          },
                        })
                      }
                    />
                  ))}
                  <Button
                    variant="outline"
                    onPress={() =>
                      onChange({
                        ...rules,
                        scoring: {
                          ...rules.scoring!,
                          placement: [...rules.scoring!.placement, 0],
                        },
                      })
                    }
                  >
                    <Text>{t('steps.advanced.addPlacement')}</Text>
                  </Button>
                </View>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
    </View>
  );
}

function RuleNumberInput({
  value,
  onNumberChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChangeText'> & {
  value: number;
  onNumberChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const parse = (text: string) =>
    text.trim() ? Number(text.replace(',', '.')) : NaN;
  return (
    <Input
      {...props}
      value={Object.is(parse(draft), value) ? draft : String(value)}
      onChangeText={(text) => {
        setDraft(text);
        onNumberChange(parse(text));
      }}
    />
  );
}
