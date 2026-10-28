import { useState } from 'react';
import { Image, View } from 'react-native';
import UserGroupIcon from '@hugeicons/core-free-icons/UserGroupIcon';
import { Icon } from '@/components/ui/icon';

export function TeamImage({ uri, name }: { uri: string | null; name: string }) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  if (!uri || failedUri === uri || !/^https?:\/\//i.test(uri)) {
    return (
      <View
        className="h-16 w-16 items-center justify-center rounded-lg bg-muted"
        accessibilityLabel={name}
      >
        <Icon icon={UserGroupIcon} tone="muted-foreground" size={28} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      className="h-16 w-16 rounded-lg bg-muted"
      accessibilityLabel={name}
      onError={() => setFailedUri(uri)}
    />
  );
}
