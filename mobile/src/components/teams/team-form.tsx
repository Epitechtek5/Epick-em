import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/i18n';
import { validateTeam } from '@/features/teams/validation';
import type { TeamValues } from '@/features/teams/types';

export function TeamForm({
  initial,
  onSave,
}: {
  initial: TeamValues;
  onSave: (values: TeamValues) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<
    Partial<Record<keyof TeamValues, string>>
  >({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const validation = validateTeam(values);
    setErrors(validation);
    if (Object.keys(validation).length > 0 || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave(values);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('errors.server'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="gap-4">
      {(['name', 'tag', 'picture_url'] as const).map((field) => (
        <View key={field} className="gap-2">
          <Text>{t(`teams.fields.${field}`)}</Text>
          <Input
            value={values[field]}
            onChangeText={(value) =>
              setValues((current) => ({ ...current, [field]: value }))
            }
            accessibilityLabel={t(`teams.fields.${field}`)}
            autoCapitalize={field === 'picture_url' ? 'none' : 'sentences'}
            keyboardType={field === 'picture_url' ? 'url' : 'default'}
            invalid={Boolean(errors[field])}
            maxLength={field === 'picture_url' ? 2048 : undefined}
          />
          {errors[field] ? <FormMessage>{t(errors[field])}</FormMessage> : null}
        </View>
      ))}
      {error ? <FormMessage>{error}</FormMessage> : null}
      <Button disabled={busy} onPress={() => void submit()}>
        <Text>{t('common.save')}</Text>
      </Button>
    </View>
  );
}
