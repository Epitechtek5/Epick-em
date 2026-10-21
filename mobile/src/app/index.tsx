import { View } from 'react-native';
import { useColorScheme } from 'nativewind';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { UserIcon } from '@hugeicons/core-free-icons';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { colors } from '@/theme/colors';

export default function HomeScreen() {
  const { colorScheme } = useColorScheme();
  const palette = colorScheme === 'dark' ? colors.dark : colors.light;

  return (
    <View className="flex-1 justify-center bg-background px-6">
      <Card>
        <CardHeader>
          <CardTitle>Epick&apos;em</CardTitle>
        </CardHeader>

        <CardContent className="gap-4">
          <Text className="text-muted-foreground">Mobile design system</Text>

          <View className="flex-row items-center gap-3">
            <HugeiconsIcon
              icon={UserIcon}
              size={24}
              color={palette.primary}
              strokeWidth={1.8}
            />
            <Text>Hugeicons is ready</Text>
          </View>

          <Button accessibilityLabel="Test primary button">
            <Text>Primary button</Text>
          </Button>
        </CardContent>
      </Card>
    </View>
  );
}
