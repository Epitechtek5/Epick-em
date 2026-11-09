import { useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { FormMessage } from '@/components/ui/feedback';
import { useTranslation } from '@/i18n';
import { statErrorKey, statFieldErrors } from '@/features/stats/errors';
import { validateStat } from '@/features/stats/validation';
import type {
  StatFieldErrors,
  StatType,
  StatValues,
} from '@/features/stats/types';

export function StatForm({
  initial,
  onSave,
}: {
  initial: StatValues;
  onSave: (values: StatValues) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState(initial);
  const [fields, setFields] = useState<StatFieldErrors>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);

  function update<K extends keyof StatValues>(field: K, value: StatValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setFields((current) => ({ ...current, [field]: undefined }));
    setError('');
  }

  async function submit() {
    if (pending.current) return;
    const invalid = validateStat(values);
    setFields(invalid);
    setError('');
    if (Object.keys(invalid).length) return;

    pending.current = true;
    setSaving(true);
    try {
      await onSave({
        name: values.name.trim(),
        key: values.key.trim(),
        type: values.type,
      });
    } catch (caught) {
      setFields(statFieldErrors(caught));
      setError(statErrorKey(caught));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <View className="gap-5">
      <Card>
        <CardHeader>
          <CardTitle>{t('stats.information')}</CardTitle>
          <CardDescription>{t('stats.formHint')}</CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          <View className="gap-2">
            <Text variant="small">{t('stats.name')}</Text>
            <Input
              accessibilityLabel={t('stats.name')}
              value={values.name}
              onChangeText={(value) => update('name', value)}
              invalid={Boolean(fields.name)}
              editable={!saving}
              autoCapitalize="sentences"
            />
            {fields.name ? <FormMessage>{t(fields.name)}</FormMessage> : null}
          </View>
          <View className="gap-2">
            <Text variant="small">{t('stats.key')}</Text>
            <Input
              accessibilityLabel={t('stats.key')}
              value={values.key}
              onChangeText={(value) => update('key', value)}
              invalid={Boolean(fields.key)}
              editable={!saving}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {fields.key ? <FormMessage>{t(fields.key)}</FormMessage> : null}
          </View>
          <View className="gap-2" accessibilityRole="radiogroup">
            <Text variant="small">{t('stats.type')}</Text>
            <View className="flex-row gap-3">
              {(['flat', 'percent'] as StatType[]).map((type) => (
                <Button
                  key={type}
                  variant={values.type === type ? 'default' : 'outline'}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: values.type === type }}
                  disabled={saving}
                  onPress={() => update('type', type)}
                >
                  <Text>{t(`stats.types.${type}`)}</Text>
                </Button>
              ))}
            </View>
            {fields.type ? <FormMessage>{t(fields.type)}</FormMessage> : null}
          </View>
        </CardContent>
      </Card>
      {error ? <FormMessage>{t(error)}</FormMessage> : null}
      <Button disabled={saving} onPress={() => void submit()}>
        {saving ? (
          <ActivityIndicator accessibilityLabel={t('stats.saving')} />
        ) : null}
        <Text>{t(saving ? 'stats.saving' : 'common.save')}</Text>
      </Button>
    </View>
  );
}
