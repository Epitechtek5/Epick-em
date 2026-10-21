import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import type { AppStackParamList } from '@/navigation/AppNavigator';

import type { User } from '@/features/auth/types';
import { useAuth } from '@/features/auth/session';
import { listUsers } from '@/features/users/api';
import { getUserErrorMessage } from '@/features/users/errors';

const PAGE_SIZE = 20;

type Navigation = NativeStackNavigationProp<AppStackParamList>;

export default function UsersScreen() {
  const navigation = useNavigation<Navigation>();
  const { token } = useAuth();

  const [users, setUsers] = useState<User[]>([]);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadPage = useCallback(
    async (nextPage: number) => {
      if (!token) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const results = await listUsers(token, {
          limit: PAGE_SIZE,
          offset: nextPage * PAGE_SIZE,
        });

        setUsers(results);
        setPage(nextPage);
        setHasNext(results.length === PAGE_SIZE);
      } catch (caught) {
        setError(getUserErrorMessage(caught));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    let active = true;

    async function loadInitialPage() {
      if (!token) return;

      try {
        const results = await listUsers(token, {
          limit: PAGE_SIZE,
          offset: 0,
        });

        if (!active) return;

        setUsers(results);
        setPage(0);
        setHasNext(results.length === PAGE_SIZE);
        setError('');
      } catch (caught) {
        if (active) {
          setError(getUserErrorMessage(caught));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadInitialPage();

    return () => {
      active = false;
    };
  }, [token]);

  async function refresh() {
    setRefreshing(true);
    await loadPage(0);
  }

  return (
    <View className="flex-1 bg-background px-5 py-5">
      <Text variant="h2" className="mb-2">
        Users
      </Text>

      <Text className="mb-5 text-muted-foreground">
        Browse registered users.
      </Text>

      {error ? (
        <View className="mb-4 gap-3">
          <Text accessibilityRole="alert" className="text-destructive">
            {error}
          </Text>
          <Button variant="outline" onPress={() => void loadPage(page)}>
            <Text>Retry</Text>
          </Button>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading users" />
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => String(item.id)}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} />
          }
          ListEmptyComponent={
            <Text className="py-6 text-center text-muted-foreground">
              No users found.
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              className="mb-3 min-h-14 justify-center rounded-md border border-border bg-card px-4 py-3"
              accessibilityRole="button"
              accessibilityLabel={`View profile for ${item.username}`}
              onPress={() =>
                navigation.navigate('UserDetails', { id: item.id })
              }
            >
              <Text className="font-semibold">{item.username}</Text>
              <Text className="text-sm text-muted-foreground">{item.role}</Text>
            </Pressable>
          )}
        />
      )}

      <View className="flex-row items-center justify-between gap-3 pt-4">
        <Button
          variant="outline"
          disabled={loading || page === 0}
          onPress={() => void loadPage(page - 1)}
        >
          <Text>Previous</Text>
        </Button>

        <Text>Page {page + 1}</Text>

        <Button
          variant="outline"
          disabled={loading || !hasNext}
          onPress={() => void loadPage(page + 1)}
        >
          <Text>Next</Text>
        </Button>
      </View>
    </View>
  );
}
