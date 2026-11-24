import { View } from 'react-native';
import { StepOptionSelect } from '@/components/steps/option-select';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import type { Stat } from '@/features/stats/types';
import type { DraftValues } from '@/features/matches/game-results';
import { useTranslation } from '@/i18n';

export function GameStatFields({
  stats,
  values,
  onChange,
  person,
  disabled,
}: {
  stats: Stat[];
  values: DraftValues;
  onChange: (values: DraftValues) => void;
  person: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View className="gap-3">
      {stats.map((stat) => {
        const label = stat.name + (stat.type === 'percent' ? ' (%)' : '');
        if (stat.type === 'select')
          return (
            <StepOptionSelect
              key={stat.id}
              label={label}
              value={values[stat.key] ?? ''}
              options={[
                '',
                ...(stat.options ?? []).map((option) => option.key),
              ]}
              labelFor={(key) =>
                key
                  ? (stat.options?.find((option) => option.key === key)
                      ?.label ?? t('matchGames.unavailableOption'))
                  : t('matches.unset')
              }
              description={
                !stat.options?.length ? t('stats.noOptions') : undefined
              }
              disabled={disabled}
              onSelect={(value) => onChange({ ...values, [stat.key]: value })}
            />
          );
        return (
          <View key={stat.id} className="gap-2">
            <Text className="font-medium">{label}</Text>
            <Input
              accessibilityLabel={person + ' · ' + label}
              keyboardType="numbers-and-punctuation"
              editable={!disabled}
              value={values[stat.key] ?? ''}
              onChangeText={(value) =>
                onChange({ ...values, [stat.key]: value })
              }
            />
          </View>
        );
      })}
    </View>
  );
}
