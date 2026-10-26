import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import type { AppStackParamList } from '@/navigation/AppNavigator';

import type { User } from '@/features/auth/types';
import { useAuth } from '@/features/auth/session';
import { getUser } from '@/features/users/api';
import { getUserErrorMessage } from '@/features/users/errors';

type UserRoute = RouteProp<AppStackParamList, 'UserDetails'>;
type Navigation = NativeStackNavigationProp<AppStackParamList>;

export default function UserDetailsScreen() {
  const route = useRoute<UserRoute>();
  const navigation = useNavigation<Navigation>();
  const { token, user: currentUser } = useAuth();

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const userId = route.params.id;

  const loadUser = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      setUser(await getUser(token, userId));
    } catch (caught) {
      setUser(null);
      setError(getUserErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [token, userId]);

  useFocusEffect(
    useCallback(() => {
      void loadUser();
    }, [loadUser]),
  );

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-5 px-5 py-8"
    >
      <Text variant="h2">User profile</Text>

      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading user profile" />
      ) : error ? (
        <View className="gap-3">
          <Text accessibilityRole="alert" className="text-destructive">
            {error}
          </Text>
          <Button variant="outline" onPress={() => void loadUser()}>
            <Text>Retry</Text>
          </Button>
        </View>
      ) : user ? (
        <View className="gap-4">
          <Text variant="h3">{user.username}</Text>
          <Text>Account ID: {user.id}</Text>
          <Text>Role: {user.role}</Text>

          {currentUser?.role === 'admin' && (
            <Button
              accessibilityLabel={`Manage ${user.username}`}
              onPress={() => navigation.navigate('AdminUser', { id: user.id })}
            >
              <Text>Manage user</Text>
            </Button>
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}
