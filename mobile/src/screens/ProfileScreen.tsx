import { useTranslation } from '@/i18n';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { PreferenceSections } from '@/components/preference-sections';
import { UserForm } from '@/components/users/user-form';

import { useAuth } from '@/features/auth/session';
import {
  deleteMe,
  updateMe,
  type UpdateAccountRequest,
} from '@/features/users/api';
import { getUserErrorMessage } from '@/features/users/errors';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { token, user, updateCurrentUser, clearSession, logout, refreshUser } =
    useAuth();

  const [loggingOut, setLoggingOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      void refreshUser().catch(() => undefined);
    }, [refreshUser]),
  );

  if (!token || !user) {
    return (
      <View className="flex-1 justify-center bg-background px-5">
        <Text>{t('errors.unauthorized')}</Text>
      </View>
    );
  }

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      Alert.alert(t('settings.localLogout'), t('settings.logoutFailed'));
    } finally {
      setLoggingOut(false);
    }
  }

  async function saveProfile(changes: UpdateAccountRequest) {
    if (!token) throw new Error('errors.unauthorized');

    try {
      const updated = await updateMe(token, changes);
      updateCurrentUser(updated);
      await refreshUser();
    } catch (caught) {
      throw new Error(getUserErrorMessage(caught));
    }
  }

  async function confirmDeletion() {
    if (!token) return;

    setDeleting(true);
    setError('');

    try {
      await deleteMe(token);
      await clearSession();
      router.replace('/login');
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      setDeleting(false);
    }
  }

  function requestDeletion() {
    Alert.alert(t('account.delete'), t('account.deleteWarning'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('account.delete'),
        style: 'destructive',
        onPress: () => void confirmDeletion(),
      },
    ]);
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 px-5 py-6"
      keyboardShouldPersistTaps="handled"
    >
      <Text variant="h2">{t('settings.title')}</Text>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.account')}</CardTitle>
        </CardHeader>
        <CardContent className="gap-2">
          <Text>{t('account.username', { username: user.username })}</Text>
          <Text>{t('account.id', { id: user.id })}</Text>
          <Text>{t('account.role', { role: user.role })}</Text>
        </CardContent>
      </Card>

      <View className="gap-4">
        <Text variant="h3">{t('settings.edit')}</Text>
        <UserForm user={user} onSave={saveProfile} />
      </View>

      <View className="gap-3 border-t border-border pt-6">
        <Text variant="h3">{t('account.danger')}</Text>
        <Text className="text-muted-foreground">
          {t('account.irreversible')}
        </Text>

        {error ? (
          <Text accessibilityRole="alert" className="text-destructive">
            {t(error)}
          </Text>
        ) : null}

        <Button
          variant="destructive"
          disabled={deleting}
          accessibilityLabel={t('account.deleteMine')}
          onPress={requestDeletion}
        >
          {deleting ? (
            <ActivityIndicator accessibilityLabel={t('common.loading')} />
          ) : (
            <Text>{t('account.deleteMine')}</Text>
          )}
        </Button>
      </View>
      <PreferenceSections />
      <View className="gap-3 border-t border-border pt-6">
        <Text variant="h3">{t('settings.session')}</Text>
        <Button
          disabled={loggingOut || deleting}
          onPress={() => void handleLogout()}
          accessibilityLabel={t('settings.logout')}
        >
          {loggingOut ? (
            <ActivityIndicator accessibilityLabel={t('settings.loggingOut')} />
          ) : (
            <Text>{t('settings.logout')}</Text>
          )}
        </Button>
      </View>
    </ScrollView>
  );
}
