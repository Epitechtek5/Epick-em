import { useState, type PropsWithChildren } from 'react';
import Animated from 'react-native-reanimated';
import { Keyboard, View } from 'react-native';
import PencilEdit02Icon from '@hugeicons/core-free-icons/PencilEdit02Icon';
import ArrowUp01Icon from '@hugeicons/core-free-icons/ArrowUp01Icon';
import ArrowDown01Icon from '@hugeicons/core-free-icons/ArrowDown01Icon';
import { contentLayout } from '@/lib/motion';
import { useTranslation } from '@/i18n';
import { Card } from './ui/card';
import { Icon } from './ui/icon';
import { MotionPressable } from './ui/motion-pressable';
import { Text } from './ui/text';

export function AccountEditor({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <Animated.View layout={contentLayout}>
      <Card className="gap-0 py-0">
        <MotionPressable
          className="min-h-16 flex-row items-center gap-3 px-4 py-4"
          accessibilityRole="button"
          accessibilityLabel={t('settings.edit')}
          accessibilityState={{ expanded }}
          onPress={() => {
            if (expanded) Keyboard.dismiss();
            setExpanded((previous) => !previous);
          }}
        >
          <Icon icon={PencilEdit02Icon} />
          <View className="flex-1 gap-1">
            <Text className="font-medium">{t('settings.edit')}</Text>
            <Text variant="muted">{t('settings.editDescription')}</Text>
          </View>
          <Icon
            icon={expanded ? ArrowUp01Icon : ArrowDown01Icon}
            tone={expanded ? 'primary' : 'muted-foreground'}
          />
        </MotionPressable>
        <View
          className={expanded ? 'border-t border-border p-4' : 'hidden'}
          accessibilityElementsHidden={!expanded}
          importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
        >
          {children}
        </View>
      </Card>
    </Animated.View>
  );
}
