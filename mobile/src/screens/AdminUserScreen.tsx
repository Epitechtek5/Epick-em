import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { router } from 'expo-router';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { UserForm } from '@/components/users/user-form';
import type { AppStackParamList } from '@/navigation/AppNavigator';

import type { User } from '@/features/auth/types';
import { useAuth } from '@/features/auth/session';
import {
  deleteUser,
  getUser,
  updateUser,
  type UpdateUserRequest,
} from '@/features/users/api';
import { getUserErrorMessage } from '@/features/users/errors';

type AdminRoute = RouteProp<AppStackParamList, 'AdminUser'>;
type Navigation = NativeStackNavigationProp<AppStackParamList>;

export default function AdminUserScreen() {
  const route = useRoute<AdminRoute>();
  const navigation = useNavigation<Navigation>();

  const {
    token,
    user: currentUser,
    updateCurrentUser,
    clearSession,
  } = useAuth();

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const userId = route.params.id;
  const isAdmin = Boolean(token && currentUser?.role === 'admin');

  const loadUser = useCallback(async () => {
    if (!token || !isAdmin) {
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
  }, [token, isAdmin, userId]);

  useFocusEffect(
    useCallback(() => {
      void loadUser();
    }, [loadUser]),
  );

  if (!isAdmin) {
    return (
      <View className="flex-1 justify-center bg-background px-5">
        <Text accessibilityRole="alert">Administrator access required.</Text>
      </View>
    );
  }

  async function saveUser(changes: UpdateUserRequest) {
    if (!token || !currentUser) {
      throw new Error('Authentication required.');
    }

    try {
      const updated = await updateUser(token, userId, changes);
      setUser(updated);

      if (updated.id === currentUser.id) {
        updateCurrentUser(updated);

        if (updated.role !== 'admin') {
          navigation.navigate('MainTabs');
        }
      }
    } catch (caught) {
      throw new Error(getUserErrorMessage(caught));
    }
  }

  async function confirmDeletion() {
    if (!token || !currentUser) return;

    setDeleting(true);
    setError('');

    try {
      await deleteUser(token, userId);

      if (userId === currentUser.id) {
        clearSession();
        router.replace('/register');
      } else {
        navigation.navigate('MainTabs');
      }
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      setDeleting(false);
    }
  }

  function requestDeletion() {
    Alert.alert(
      'Delete user',
      `Permanently delete ${user?.username ?? 'this user'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete user',
          style: 'destructive',
          onPress: () => void confirmDeletion(),
        },
      ],
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 px-5 py-8"
      keyboardShouldPersistTaps="handled"
    >
      <Text variant="h2">Manage user</Text>

      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading user" />
      ) : error && !user ? (
        <View className="gap-3">
          <Text accessibilityRole="alert" className="text-destructive">
            {error}
          </Text>
          <Button variant="outline" onPress={() => void loadUser()}>
            <Text>Retry</Text>
          </Button>
        </View>
      ) : user ? (
        <>
          <View className="gap-2">
            <Text>Account ID: {user.id}</Text>
            <Text>Current role: {user.role}</Text>
          </View>

          <UserForm
            key={`${user.id}-${user.username}-${user.role}`}
            user={user}
            onSave={saveUser}
          />

          <View className="gap-3 border-t border-border pt-6">
            <Text variant="h3">Danger zone</Text>

            {error ? (
              <Text accessibilityRole="alert" className="text-destructive">
                {error}
              </Text>
            ) : null}

            <Button
              variant="destructive"
              disabled={deleting}
              accessibilityLabel={`Delete user ${user.username}`}
              onPress={requestDeletion}
            >
              {deleting ? <ActivityIndicator /> : <Text>Delete user</Text>}
            </Button>
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}
