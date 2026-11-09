import { Tabs } from 'expo-router';
import { TabIcon } from '@/components/ui/tab-icon';
import { colors as themeColors } from '@/theme/colors';
import Settings01Icon from '@hugeicons/core-free-icons/Settings01Icon';
import UserGroupIcon from '@hugeicons/core-free-icons/UserGroupIcon';
import GameController03Icon from '@hugeicons/core-free-icons/GameController03Icon';
import { useReducedMotionPreference } from '@/lib/motion';
import { useTheme } from '@react-navigation/native';
import { useTranslation } from '@/i18n';

export default function TabsLayout() {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotionPreference();
  const { colors, dark } = useTheme();
  const palette = dark ? themeColors.dark : themeColors.light;
  return (
    <Tabs
      screenOptions={{
        animation: reducedMotion ? 'none' : 'fade',
        transitionSpec: {
          animation: 'timing',
          config: { duration: reducedMotion ? 0 : 180 },
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarItemStyle: { minHeight: 48, paddingVertical: 2 },
        headerShadowVisible: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: palette['muted-foreground'],
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
        name="games"
        options={{
          title: t('games.title'),
          tabBarAccessibilityLabel: t('games.title'),
          tabBarIcon: ({ focused, size }) => (
            <TabIcon
              icon={GameController03Icon}
              size={size}
              focused={focused}
              testID="games-tab-icon"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('settings.title'),
          tabBarAccessibilityLabel: t('settings.title'),
          tabBarIcon: ({ focused, size }) => (
            <TabIcon
              icon={Settings01Icon}
              size={size}
              focused={focused}
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
          tabBarIcon: ({ focused, size }) => (
            <TabIcon
              icon={UserGroupIcon}
              size={size}
              focused={focused}
              testID="users-tab-icon"
            />
          ),
        }}
      />
    </Tabs>
  );
}
