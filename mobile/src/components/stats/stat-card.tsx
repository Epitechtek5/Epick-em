import { View } from 'react-native';
import { Card, CardContent } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/i18n';
import type { Stat } from '@/features/stats/types';

export function StatCard({ stat }: { stat: Stat }) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardContent className="gap-2 pt-5">
        <Text variant="large">{stat.name}</Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <Text variant="muted">{stat.key}</Text>
          <Text variant="muted">· {t(`stats.types.${stat.type}`)}</Text>
        </View>
      </CardContent>
    </Card>
  );
}
