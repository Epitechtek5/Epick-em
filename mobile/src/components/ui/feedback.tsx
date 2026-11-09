import { ActivityIndicator, View } from 'react-native';
import Animated from 'react-native-reanimated';
import AlertCircleIcon from '@hugeicons/core-free-icons/AlertCircleIcon';
import CheckmarkCircle02Icon from '@hugeicons/core-free-icons/CheckmarkCircle02Icon';
import UserGroupIcon from '@hugeicons/core-free-icons/UserGroupIcon';
import { contentEntrance } from '@/lib/motion';
import { useTranslation } from '@/i18n';
import { Button } from './button';
import { Icon } from './icon';
import { Text } from './text';

export function FormMessage({
  children,
  success = false,
}: {
  children: string;
  success?: boolean;
}) {
  return (
    <Animated.View
      entering={contentEntrance}
      className="flex-row items-start gap-2 rounded-md bg-muted p-3"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Icon
        icon={success ? CheckmarkCircle02Icon : AlertCircleIcon}
        tone={success ? 'primary' : 'destructive'}
        size={18}
      />
      <Text
        className={`flex-1 text-sm leading-5 ${success ? 'text-foreground' : 'text-destructive'}`}
      >
        {children}
      </Text>
    </Animated.View>
  );
}

export function ScreenState({
  message,
  loading = false,
  error = false,
  onRetry,
}: {
  message: string;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View
      className="items-center justify-center gap-4 px-6 py-12"
      accessibilityLiveRegion="polite"
    >
      <View className="h-12 w-12 items-center justify-center rounded-lg bg-muted">
        {loading ? (
          <ActivityIndicator accessibilityLabel={message} />
        ) : (
          <Icon
            icon={error ? AlertCircleIcon : UserGroupIcon}
            tone={error ? 'destructive' : 'muted-foreground'}
            size={24}
          />
        )}
      </View>
      <Text
        className="text-center text-sm leading-6 text-muted-foreground"
        accessibilityRole={error ? 'alert' : undefined}
      >
        {message}
      </Text>
      {onRetry ? (
        <Button variant="outline" onPress={onRetry}>
          <Text>{t('common.retry')}</Text>
        </Button>
      ) : null}
    </View>
  );
}
