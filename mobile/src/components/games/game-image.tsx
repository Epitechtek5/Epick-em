import { useState } from 'react';
import { Image, View } from 'react-native';
import GameController03Icon from '@hugeicons/core-free-icons/GameController03Icon';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/i18n';

export function GameImage({ uri, name }: { uri?: string; name: string }) {
  const { t } = useTranslation();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  if (!uri || failedUri === uri || !/^https?:\/\//i.test(uri)) {
    return (
      <View
        className="aspect-video w-full items-center justify-center gap-2 rounded-lg bg-muted"
        accessibilityLabel={t('games.imageUnavailable', { name })}
      >
        <Icon icon={GameController03Icon} size={40} tone="muted-foreground" />
        <Text variant="muted">{t('games.noImage')}</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      className="aspect-video w-full rounded-lg bg-muted"
      resizeMode="cover"
      accessibilityLabel={t('games.image', { name })}
      onError={() => setFailedUri(uri)}
    />
  );
}
