import { memo } from 'react';
import { View } from 'react-native';
import ArrowRight01Icon from '@hugeicons/core-free-icons/ArrowRight01Icon';
import { Card, CardContent } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { MotionPressable } from '@/components/ui/motion-pressable';
import { useTranslation } from '@/i18n';
import type { Game } from '@/features/games/types';
import { GameImage } from './game-image';

export const GameCard = memo(function GameCard({
  game,
  onPress,
}: {
  game: Game;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={t('games.view', { name: game.name })}
      onPress={onPress}
    >
      <Card className="gap-4 p-4">
        <GameImage uri={game.images[0]} name={game.name} />
        <CardContent className="gap-2 px-0">
          <View className="flex-row items-center gap-3">
            <Text variant="large" className="flex-1" numberOfLines={2}>
              {game.name}
            </Text>
            <Icon icon={ArrowRight01Icon} tone="muted-foreground" />
          </View>
          <Text variant="muted" numberOfLines={3}>
            {game.description || t('games.noDescription')}
          </Text>
        </CardContent>
      </Card>
    </MotionPressable>
  );
});
