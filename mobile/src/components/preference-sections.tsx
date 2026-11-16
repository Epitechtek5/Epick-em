import { ActivityIndicator, Switch, View } from 'react-native';
import type { IconSvgElement } from '@hugeicons/react-native';
import ComputerIcon from '@hugeicons/core-free-icons/ComputerIcon';
import Sun03Icon from '@hugeicons/core-free-icons/Sun03Icon';
import Moon02Icon from '@hugeicons/core-free-icons/Moon02Icon';
import LanguageCircleIcon from '@hugeicons/core-free-icons/LanguageCircleIcon';
import Tick02Icon from '@hugeicons/core-free-icons/Tick02Icon';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormMessage } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { usePreferences } from '@/features/preferences/provider';
import {
  NOTIFICATION_CATEGORIES,
  type NotificationChannel,
} from '@/features/preferences/api';
import { useTranslation } from '@/i18n';

function PreferenceRow({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon: IconSvgElement;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      variant="ghost"
      role="radio"
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      className="min-h-14 justify-start rounded-none px-4 py-4"
      onPress={onPress}
    >
      <Icon icon={icon} tone={selected ? 'primary' : 'muted-foreground'} />
      <Text className="flex-1 text-left font-medium">{label}</Text>
      {selected ? (
        <Icon icon={Tick02Icon} tone="foreground" />
      ) : (
        <View className="h-5 w-5" />
      )}
    </Button>
  );
}

export function PreferenceSections() {
  const { t } = useTranslation();
  const {
    theme,
    language,
    notifications,
    setTheme,
    setLanguage,
    setNotification,
    syncing,
    error,
  } = usePreferences();
  return (
    <>
      <View className="gap-3">
        <Text variant="small" role="heading" aria-level={2}>
          {t('settings.appearance')}
        </Text>
        <Card
          className="gap-0 overflow-hidden py-0"
          accessibilityRole="radiogroup"
          accessibilityLabel={t('settings.appearance')}
        >
          {(
            [
              { value: 'system', icon: ComputerIcon },
              { value: 'light', icon: Sun03Icon },
              { value: 'dark', icon: Moon02Icon },
            ] as const
          ).map((option, index) => (
            <View key={option.value}>
              {index > 0 ? (
                <View className="mx-4 border-t border-border" />
              ) : null}
              <PreferenceRow
                label={t(`settings.${option.value}`)}
                icon={option.icon}
                selected={theme === option.value}
                onPress={() => setTheme(option.value)}
              />
            </View>
          ))}
        </Card>
      </View>
      <View className="gap-3">
        <Text variant="small" role="heading" aria-level={2}>
          {t('settings.language')}
        </Text>
        <Card
          className="gap-0 overflow-hidden py-0"
          accessibilityRole="radiogroup"
          accessibilityLabel={t('settings.language')}
        >
          {(
            [
              { value: 'en', label: 'settings.english' },
              { value: 'fr', label: 'settings.french' },
              { value: 'es', label: 'settings.spanish' },
            ] as const
          ).map((option, index) => (
            <View key={option.value}>
              {index > 0 ? (
                <View className="mx-4 border-t border-border" />
              ) : null}
              <PreferenceRow
                label={t(option.label)}
                icon={LanguageCircleIcon}
                selected={language === option.value}
                onPress={() => setLanguage(option.value)}
              />
            </View>
          ))}
        </Card>
      </View>
      <View className="gap-3">
        <View className="flex-row items-center justify-between gap-3">
          <Text variant="small" role="heading" aria-level={2}>
            {t('settings.notifications')}
          </Text>
          {syncing ? (
            <ActivityIndicator
              size="small"
              accessibilityLabel={t('settings.syncing')}
            />
          ) : null}
        </View>
        <Card className="gap-0 overflow-hidden py-0">
          {NOTIFICATION_CATEGORIES.map((category, index) => (
            <View key={category}>
              {index > 0 ? (
                <View className="mx-4 border-t border-border" />
              ) : null}
              <View className="gap-3 px-4 py-4">
                <Text className="font-medium">
                  {t(`settings.categories.${category}`)}
                </Text>
                <View className="flex-row flex-wrap gap-6">
                  {(['email', 'push'] as NotificationChannel[]).map(
                    (channel) => {
                      const label = t(`settings.channels.${channel}`);
                      return (
                        <View
                          key={channel}
                          className="min-h-11 flex-1 flex-row items-center justify-between gap-3"
                        >
                          <Text variant="muted">{label}</Text>
                          <Switch
                            accessibilityLabel={`${t(`settings.categories.${category}`)} · ${label}`}
                            value={notifications[category][channel]}
                            onValueChange={(enabled) =>
                              setNotification(category, channel, enabled)
                            }
                          />
                        </View>
                      );
                    },
                  )}
                </View>
              </View>
            </View>
          ))}
        </Card>
      </View>
      {error ? <FormMessage>{t(error)}</FormMessage> : null}
    </>
  );
}
