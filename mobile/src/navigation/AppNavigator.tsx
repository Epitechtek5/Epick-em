import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import ProfileScreen from '@/screens/ProfileScreen';
import UsersScreen from '@/screens/UsersScreen';
import UserDetailsScreen from '@/screens/UserDetailsScreen';
import AdminUserScreen from '@/screens/AdminUserScreen';

export type AppStackParamList = {
  MainTabs: undefined;
  UserDetails: { id: number };
  AdminUser: { id: number };
};

type AppTabParamList = {
  Profile: undefined;
  Users: undefined;
};

const Stack = createNativeStackNavigator<AppStackParamList>();
const Tabs = createBottomTabNavigator<AppTabParamList>();

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: '#7C3AED',
      }}
    >
      <Tabs.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: 'My profile' }}
      />
      <Tabs.Screen
        name="Users"
        component={UsersScreen}
        options={{ title: 'Users' }}
      />
    </Tabs.Navigator>
  );
}

export default function AppNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="MainTabs"
        component={MainTabs}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="UserDetails"
        component={UserDetailsScreen}
        options={{ title: 'User profile' }}
      />
      <Stack.Screen
        name="AdminUser"
        component={AdminUserScreen}
        options={{ title: 'Manage user' }}
      />
    </Stack.Navigator>
  );
}
