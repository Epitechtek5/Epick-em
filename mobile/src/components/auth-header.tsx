import { Image, View } from 'react-native';

import { Text } from '@/components/ui/text';

interface AuthHeaderProps {
  title: string;
  description: string;
}

export function AuthHeader({ title, description }: AuthHeaderProps) {
  return (
    <View className="items-center gap-3">
      <Image
        source={require('./assets/Epickem-logo.png')}
        className="mb-3 h-24 w-24"
        resizeMode="contain"
        accessibilityLabel="Epick'em logo"
      />

      <Text className="text-center text-3xl font-bold">{title}</Text>

      <Text className="text-center text-muted-foreground">{description}</Text>
    </View>
  );
}
