import { View } from 'react-native';
import UserCircleIcon from '@hugeicons/core-free-icons/UserCircleIcon';
import ShieldUserIcon from '@hugeicons/core-free-icons/ShieldUserIcon';
import UserIcon from '@hugeicons/core-free-icons/UserIcon';
import EyeIcon from '@hugeicons/core-free-icons/EyeIcon';
import type { User } from '@/features/auth/types';
import { useTranslation } from '@/i18n';
import { Card, CardContent } from './ui/card';
import { Icon } from './ui/icon';
import { Text } from './ui/text';

export function RoleBadge({ role }: { role: User['role'] }) {
  const { t } = useTranslation();
  const icon =
    role === 'admin' ? ShieldUserIcon : role === 'watcher' ? EyeIcon : UserIcon;
  return (
    <View
      className="flex-row items-center gap-1.5 self-start rounded-md bg-secondary px-2 py-1"
      accessibilityLabel={t('account.role', { role })}
    >
      <Icon icon={icon} size={14} />
      <Text className="text-xs font-medium text-secondary-foreground">
        {role}
      </Text>
    </View>
  );
}

export function AccountSummary({ user }: { user: User }) {
  const { t } = useTranslation();
  return (
    <Card className="gap-4 py-4">
      <CardContent className="gap-4 px-4">
        <View className="flex-row items-center gap-3">
          <View className="h-12 w-12 items-center justify-center rounded-lg bg-muted">
            <Icon icon={UserCircleIcon} size={28} tone="primary" />
          </View>
          <View className="flex-1 gap-2">
            <Text variant="large" role="heading" aria-level={2} selectable>
              {user.username}
            </Text>
            <RoleBadge role={user.role} />
          </View>
        </View>
        <View className="gap-1 border-t border-border pt-3">
          <Text variant="muted">{t('account.identifier')}</Text>
          <Text className="text-xs leading-5 text-muted-foreground" selectable>
            {user.id}
          </Text>
        </View>
      </CardContent>
    </Card>
  );
}
