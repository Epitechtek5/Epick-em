import { useState } from 'react';
import { Image, View } from 'react-native';
import UserCircleIcon from '@hugeicons/core-free-icons/UserCircleIcon';
import { Icon } from '@/components/ui/icon';

const SIZES = {
  sm: { frame: 'h-11 w-11 rounded-full', icon: 25 },
  md: { frame: 'h-12 w-12 rounded-lg', icon: 28 },
} as const;

export function UserAvatar({
  uri,
  name,
  size = 'md',
}: {
  uri?: string | null;
  name: string;
  size?: keyof typeof SIZES;
}) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const sizing = SIZES[size];
  if (!uri || failedUri === uri || !/^https?:\/\//i.test(uri)) {
    return (
      <View
        className={`${sizing.frame} items-center justify-center bg-muted`}
        accessibilityLabel={name}
      >
        <Icon icon={UserCircleIcon} size={sizing.icon} tone="primary" />
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
