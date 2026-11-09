import { useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Add01Icon from '@hugeicons/core-free-icons/Add01Icon';
import ArrowUp01Icon from '@hugeicons/core-free-icons/ArrowUp01Icon';
import ArrowDown01Icon from '@hugeicons/core-free-icons/ArrowDown01Icon';
import Delete02Icon from '@hugeicons/core-free-icons/Delete02Icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { FormMessage } from '@/components/ui/feedback';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import type { GameFieldErrors, GameValues } from '@/features/games/types';
import { validateGame } from '@/features/games/validation';
import { gameErrorKey, gameFieldErrors } from '@/features/games/errors';
import { useTranslation } from '@/i18n';

export function GameForm({
  initial,
  onSave,
}: {
  initial: GameValues;
  onSave: (values: GameValues) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState(initial);
  const [fields, setFields] = useState<GameFieldErrors>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);

  function update<K extends keyof GameValues>(field: K, value: GameValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setFields((current) => ({ ...current, [field]: undefined }));
    setError('');
  }

  function moveImage(index: number, direction: number) {
    const images = [...values.images];
    const target = index + direction;
    [images[index], images[target]] = [images[target], images[index]];
    update('images', images);
  }

  async function submit() {
    if (pending.current) return;
    const invalid = validateGame(values);
    setFields(invalid);
    setError('');
    if (Object.keys(invalid).length) return;
    pending.current = true;
    setSaving(true);
    try {
      await onSave({ ...values, name: values.name.trim() });
    } catch (caught) {
      setFields(gameFieldErrors(caught));
      setError(gameErrorKey(caught));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <View className="gap-5">
      <Card>
        <CardHeader>
          <CardTitle>{t('games.information')}</CardTitle>
          <CardDescription>{t('games.formHint')}</CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          <View className="gap-2">
            <Text variant="small">{t('games.name')}</Text>
            <Input
              accessibilityLabel={t('games.name')}
              value={values.name}
              onChangeText={(value) => update('name', value)}
              invalid={Boolean(fields.name)}
              editable={!saving}
              autoCapitalize="sentences"
            />
            {fields.name ? <FormMessage>{t(fields.name)}</FormMessage> : null}
          </View>
          <View className="gap-2">
            <Text variant="small">{t('games.descriptionField')}</Text>
            <Input
              accessibilityLabel={t('games.descriptionField')}
              value={values.description}
              onChangeText={(value) => update('description', value)}
              invalid={Boolean(fields.description)}
              editable={!saving}
              multiline
              textAlignVertical="top"
              className="min-h-28"
            />
            {fields.description ? (
              <FormMessage>{t(fields.description)}</FormMessage>
            ) : null}
          </View>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('games.images')}</CardTitle>
          <CardDescription>{t('games.imagesHint')}</CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          {values.images.map((uri, index) => (
            <View key={index} className="gap-2">
              <Text variant="small">
                {t('games.imageNumber', { number: index + 1 })}
              </Text>
              <Input
                accessibilityLabel={t('games.imageNumber', {
                  number: index + 1,
                })}
                value={uri}
                onChangeText={(value) =>
                  update(
                    'images',
                    values.images.map((image, imageIndex) =>
                      imageIndex === index ? value : image,
                    ),
                  )
                }
                editable={!saving}
                invalid={Boolean(fields.images)}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <View className="flex-row justify-end gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={saving || index === 0}
                  accessibilityLabel={t('games.moveUp', { number: index + 1 })}
                  onPress={() => moveImage(index, -1)}
                >
                  <Icon icon={ArrowUp01Icon} />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={saving || index === values.images.length - 1}
                  accessibilityLabel={t('games.moveDown', {
                    number: index + 1,
                  })}
                  onPress={() => moveImage(index, 1)}
                >
                  <Icon icon={ArrowDown01Icon} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={saving}
                  accessibilityLabel={t('games.removeImage', {
                    number: index + 1,
                  })}
                  onPress={() =>
                    update(
                      'images',
                      values.images.filter(
                        (_, imageIndex) => imageIndex !== index,
                      ),
                    )
                  }
                >
                  <Icon icon={Delete02Icon} tone="destructive" />
                </Button>
              </View>
            </View>
          ))}
          {fields.images ? <FormMessage>{t(fields.images)}</FormMessage> : null}
          <Button
            variant="outline"
            disabled={saving || values.images.length >= 10}
            onPress={() => update('images', [...values.images, ''])}
          >
            <Icon icon={Add01Icon} />
            <Text>{t('games.addImage')}</Text>
          </Button>
        </CardContent>
      </Card>
      {error ? <FormMessage>{t(error)}</FormMessage> : null}
      <Button
        disabled={saving}
        accessibilityLabel={t('common.save')}
        onPress={() => void submit()}
      >
        {saving ? (
          <ActivityIndicator accessibilityLabel={t('games.saving')} />
        ) : null}
        <Text>{t(saving ? 'games.saving' : 'common.save')}</Text>
      </Button>
    </View>
  );
}
