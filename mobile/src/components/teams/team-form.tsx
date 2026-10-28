import { useState } from 'react';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  beforeFields,
}: {
  initial: TeamValues;
  onSave: (values: TeamValues) => Promise<void>;
  beforeFields?: ReactNode;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
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
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pt-5 pb-5"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      >
        {beforeFields}
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
            {errors[field] ? (
              <FormMessage>{t(errors[field])}</FormMessage>
            ) : null}
          </View>
        ))}
        {error ? <FormMessage>{error}</FormMessage> : null}
      </ScrollView>
      <View
        className="border-t border-border bg-background px-5 pt-3"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
      >
        <Button disabled={busy} onPress={() => void submit()}>
          <Text>{t('common.save')}</Text>
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
}
