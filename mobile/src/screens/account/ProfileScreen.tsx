import { useTranslation } from '@/i18n';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { Button } from '@/components/ui/button';
import { AccountSummary } from '@/components/account-summary';
import { AccountEditor } from '@/components/account-editor';
import { Icon } from '@/components/ui/icon';
import { FormMessage } from '@/components/ui/feedback';
import Logout01Icon from '@hugeicons/core-free-icons/Logout01Icon';
import Delete02Icon from '@hugeicons/core-free-icons/Delete02Icon';
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
      contentContainerClassName="gap-6 px-5 py-5"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <View className="gap-3">
        <Text variant="small" role="heading" aria-level={2}>
          {t('settings.account')}
        </Text>
        <AccountSummary user={user} />
        <AccountEditor>
          <UserForm user={user} onSave={saveProfile} />
        </AccountEditor>
        <View className="gap-3 pt-1">
          <Text variant="muted">{t('account.irreversible')}</Text>
          {error ? <FormMessage>{t(error)}</FormMessage> : null}
          <Button
            variant="ghost"
            className="justify-start px-0"
            disabled={deleting}
            accessibilityLabel={t('account.deleteMine')}
            onPress={requestDeletion}
          >
            {deleting ? (
              <ActivityIndicator accessibilityLabel={t('common.loading')} />
            ) : (
              <Icon icon={Delete02Icon} tone="destructive" />
            )}
            <Text className="text-destructive">{t('account.deleteMine')}</Text>
          </Button>
        </View>
      </View>
      <PreferenceSections />
      <View className="gap-3">
        <Text variant="small" role="heading" aria-level={2}>
          {t('settings.session')}
        </Text>
        <Button
          variant="outline"
          disabled={loggingOut || deleting}
          onPress={() => void handleLogout()}
          accessibilityLabel={t('settings.logout')}
        >
          {loggingOut ? (
            <ActivityIndicator accessibilityLabel={t('settings.loggingOut')} />
          ) : (
            <Icon icon={Logout01Icon} tone="foreground" />
          )}
          <Text>{t('settings.logout')}</Text>
        </Button>
      </View>
    </ScrollView>
  );
}
