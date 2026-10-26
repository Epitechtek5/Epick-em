import { Tabs } from 'expo-router';
import { HugeiconsIcon } from '@hugeicons/react-native';
import Settings01Icon from '@hugeicons/core-free-icons/Settings01Icon';
import UserGroupIcon from '@hugeicons/core-free-icons/UserGroupIcon';
import { useTheme } from '@react-navigation/native';
import { useTranslation } from '@/i18n';

export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.text,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
        },
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="profile"
        options={{
          title: t('settings.title'),
          tabBarAccessibilityLabel: t('settings.title'),
          tabBarIcon: ({ color, size }) => (
            <HugeiconsIcon
              icon={Settings01Icon}
              size={size}
              color={color}
              accessible={false}
              testID="settings-tab-icon"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="users"
        options={{
          title: t('users.title'),
          tabBarAccessibilityLabel: t('users.title'),
          tabBarIcon: ({ color, size }) => (
            <HugeiconsIcon
              icon={UserGroupIcon}
              size={size}
              color={color}
              accessible={false}
              testID="users-tab-icon"
            />
          ),
        }}
      />
    </Tabs>
  );
}
