import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { usePreferences } from '@/features/preferences/provider';
import { useTranslation } from '@/i18n';

export function PreferenceSections() {
  const { t } = useTranslation();
  const { theme, language, setTheme, setLanguage, error } = usePreferences();
  return (
    <>
      <View className="gap-3 border-t border-border pt-6">
        <Text variant="h3">{t('settings.appearance')}</Text>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t('settings.appearance')}
          className="flex-row flex-wrap gap-2"
        >
          {(['system', 'light', 'dark'] as const).map((option) => (
            <Button
              key={option}
              role="radio"
              accessibilityRole="radio"
              accessibilityState={{ checked: theme === option }}
              variant={theme === option ? 'default' : 'outline'}
              onPress={() => setTheme(option)}
            >
              <Text>{t(`settings.${option}`)}</Text>
            </Button>
          ))}
        </View>
      </View>
      <View className="gap-3 border-t border-border pt-6">
        <Text variant="h3">{t('settings.language')}</Text>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t('settings.language')}
          className="flex-row flex-wrap gap-2"
        >
          {(
            [
              { value: 'en', label: 'settings.english' },
              { value: 'fr', label: 'settings.french' },
            ] as const
          ).map((option) => (
            <Button
              key={option.value}
              role="radio"
              accessibilityRole="radio"
              accessibilityState={{ checked: language === option.value }}
              variant={language === option.value ? 'default' : 'outline'}
              onPress={() => setLanguage(option.value)}
            >
              <Text>{t(option.label)}</Text>
            </Button>
          ))}
        </View>
      </View>
      {error ? (
        <Text accessibilityRole="alert" className="text-destructive">
          {t(error)}
        </Text>
      ) : null}
    </>
  );
}
