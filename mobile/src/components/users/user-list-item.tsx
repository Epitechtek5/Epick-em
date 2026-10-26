import { View } from 'react-native';
import UserCircleIcon from '@hugeicons/core-free-icons/UserCircleIcon';
import ArrowRight01Icon from '@hugeicons/core-free-icons/ArrowRight01Icon';
import type { User } from '@/features/auth/types';
import { useTranslation } from '@/i18n';
import { RoleBadge } from '@/components/account-summary';
import { Icon } from '@/components/ui/icon';
import { MotionPressable } from '@/components/ui/motion-pressable';
import { Text } from '@/components/ui/text';

export function UserListItem({
  user,
  disabled,
  onPress,
}: {
  user: User;
  disabled: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <MotionPressable
      className="min-h-24 flex-row items-center gap-3 bg-card px-4 py-4 active:bg-accent"
      accessibilityRole="button"
      accessibilityLabel={t('users.view', { username: user.username })}
      accessibilityHint={t('users.rowHint', { id: user.id, role: user.role })}
      disabled={disabled}
      onPress={onPress}
    >
      <View className="h-11 w-11 items-center justify-center rounded-lg bg-muted">
        <Icon icon={UserCircleIcon} size={25} />
      </View>
      <View className="flex-1 gap-2">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="max-w-full shrink font-semibold">
            {user.username}
          </Text>
          <RoleBadge role={user.role} />
        </View>
        <Text
          className="text-xs leading-5 text-muted-foreground"
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {user.id}
        </Text>
      </View>
      <Icon icon={ArrowRight01Icon} size={18} />
    </MotionPressable>
  );
}
