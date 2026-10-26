import { Redirect } from 'expo-router';

import { useAuth } from '@/features/auth/session';
import AppNavigator from '@/navigation/AppNavigator';

export default function IndexScreen() {
  const { token, user } = useAuth();

  if (!token || !user) {
    return <Redirect href="/register" />;
  }

  return <AppNavigator />;
}
