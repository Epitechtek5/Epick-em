import { useTranslation } from '@/i18n';
import { Image, View } from 'react-native';

import { Text } from '@/components/ui/text';

interface AuthHeaderProps {
  title: string;
  description: string;
}

export function AuthHeader({ title, description }: AuthHeaderProps) {
  const { t } = useTranslation();
  return (
    <View className="gap-5">
      <Image
        source={require('./assets/Epickem-logo.png')}
        className="h-16 w-16"
        resizeMode="contain"
        accessibilityLabel={t('common.logo')}
      />

      <View className="gap-2">
        <Text variant="h2" className="border-b-0 pb-0">
          {title}
        </Text>
        <Text className="leading-6 text-muted-foreground">{description}</Text>
      </View>
    </View>
  );
}
