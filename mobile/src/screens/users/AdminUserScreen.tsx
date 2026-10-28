import { AccountSummary } from '@/components/account-summary';
import { ScreenState, FormMessage } from '@/components/ui/feedback';
import { Card, CardContent } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import PencilEdit02Icon from '@hugeicons/core-free-icons/PencilEdit02Icon';
import { useTranslation } from '@/i18n';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import {
  useFocusEffect,
  useLocalSearchParams,
  router,
  Redirect,
} from 'expo-router';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { UserForm } from '@/components/users/user-form';

import type { User } from '@/features/auth/types';
import { useAuth } from '@/features/auth/session';
import {
  deleteUser,
  getUser,
  updateUser,
  type UpdateUserRequest,
} from '@/features/users/api';
import { getUserErrorMessage } from '@/features/users/errors';

export default function AdminUserScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();

  const {
    token,
    user: currentUser,
    updateCurrentUser,
    clearSession,
    refreshUser,
  } = useAuth();

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const userId = id;
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
      void refreshUser().catch(() => undefined);
    }, [loadUser, refreshUser]),
  );

  if (!isAdmin) return <Redirect href="/(authenticated)/(tabs)/users" />;

  async function saveUser(changes: UpdateUserRequest) {
    if (!token || currentUser?.role !== 'admin') {
      throw new Error('errors.unauthorized');
    }

    try {
      const updated = await updateUser(token, userId, changes);
      setUser(updated);
      await refreshUser();

      if (updated.id === currentUser.id) {
        updateCurrentUser(updated);

        if (updated.role !== 'admin') {
          router.replace('/(authenticated)/(tabs)/users');
        }
      }
    } catch (caught) {
      await refreshUser().catch(() => undefined);
      throw new Error(getUserErrorMessage(caught));
    }
  }

  async function confirmDeletion() {
    if (!token || currentUser?.role !== 'admin') return;

    setDeleting(true);
    setError('');

    try {
      await deleteUser(token, userId);

      if (userId === currentUser.id) {
        await clearSession();
        router.replace('/login');
      } else {
        router.replace('/(authenticated)/(tabs)/users');
      }
    } catch (caught) {
      await refreshUser().catch(() => undefined);
      setError(getUserErrorMessage(caught));
    } finally {
      setDeleting(false);
    }
  }

  function requestDeletion() {
    Alert.alert(
      t('admin.delete'),
      t('admin.confirmDelete', {
        username: user?.username ?? t('admin.thisUser'),
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('admin.delete'),
          style: 'destructive',
          onPress: () => void confirmDeletion(),
        },
      ],
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-5 px-5 py-5"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      {loading ? (
        <ScreenState loading message={t('admin.loading')} />
      ) : error && !user ? (
        <ScreenState error message={t(error)} onRetry={() => void loadUser()} />
      ) : user ? (
        <>
          <AccountSummary user={user} />
          <View className="gap-3">
            <View className="flex-row items-center gap-2">
              <Icon icon={PencilEdit02Icon} />
              <Text variant="small" role="heading" aria-level={2}>
                {t('settings.edit')}
              </Text>
            </View>
            <Card className="py-4">
              <CardContent className="px-4">
                <UserForm user={user} allowRoleEdit onSave={saveUser} />
              </CardContent>
            </Card>
          </View>

          <View className="gap-3 border-t border-border pt-6">
            <Text variant="small" role="heading" aria-level={2}>
              {t('account.danger')}
            </Text>
            <Text variant="muted">{t('admin.deleteWarning')}</Text>

            {error ? <FormMessage>{t(error)}</FormMessage> : null}

            <Button
              variant="destructive"
              disabled={deleting}
              accessibilityLabel={t('admin.deleteNamed', {
                username: user.username,
              })}
              onPress={requestDeletion}
            >
              {deleting ? (
                <ActivityIndicator accessibilityLabel={t('common.loading')} />
              ) : (
                <Text>{t('admin.delete')}</Text>
              )}
            </Button>
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}
