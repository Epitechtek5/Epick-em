import { useState } from 'react';
import { Image, View } from 'react-native';
import UserGroupIcon from '@hugeicons/core-free-icons/UserGroupIcon';
import { Icon } from '@/components/ui/icon';

const SIZES = {
  sm: { frame: 'h-11 w-11 rounded-full', icon: 20 },
  md: { frame: 'h-16 w-16 rounded-lg', icon: 28 },
  lg: { frame: 'h-20 w-20 rounded-xl', icon: 34 },
} as const;

export function TeamImage({
  uri,
  name,
  size = 'md',
}: {
  uri: string | null;
  name: string;
  size?: keyof typeof SIZES;
}) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const sizing = SIZES[size];
  if (!uri || failedUri === uri || !/^https?:\/\//i.test(uri)) {
    return (
      <View
        className={`${sizing.frame} items-center justify-center bg-primary/10`}
        accessibilityLabel={name}
      >
        <Icon icon={UserGroupIcon} tone="primary" size={sizing.icon} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      className={`${sizing.frame} bg-muted`}
      accessibilityLabel={name}
      onError={() => setFailedUri(uri)}
    />
  );
}
