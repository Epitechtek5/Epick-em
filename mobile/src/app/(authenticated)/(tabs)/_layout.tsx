import { Tabs } from 'expo-router';
import { TabIcon } from '@/components/ui/tab-icon';
import { colors as themeColors } from '@/theme/colors';
import Settings01Icon from '@hugeicons/core-free-icons/Settings01Icon';
import TeamWorkIcon from '@hugeicons/core-free-icons/TeamWorkIcon';
import GameController03Icon from '@hugeicons/core-free-icons/GameController03Icon';
import TrophyIcon from '@hugeicons/core-free-icons/TrophyIcon';
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
        name="tournaments"
        options={{
          title: t('tournaments.title'),
          tabBarAccessibilityLabel: t('tournaments.title'),
          tabBarIcon: ({ focused, size }) => (
            <TabIcon
              icon={TrophyIcon}
              size={size}
              focused={focused}
              testID="tournaments-tab-icon"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="teams"
        options={{
          title: t('teams.title'),
          tabBarAccessibilityLabel: t('teams.title'),
          tabBarIcon: ({ focused, size }) => (
            <TabIcon
              icon={TeamWorkIcon}
              size={size}
              focused={focused}
              testID="teams-tab-icon"
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
      <Tabs.Screen name="users" options={{ href: null }} />
    </Tabs>
  );
}
