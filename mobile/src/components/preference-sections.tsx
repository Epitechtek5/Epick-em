import { View } from 'react-native';
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
  const { theme, language, setTheme, setLanguage, error } = usePreferences();
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
      {error ? <FormMessage>{t(error)}</FormMessage> : null}
    </>
  );
}
