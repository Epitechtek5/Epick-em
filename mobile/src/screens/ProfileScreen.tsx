import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { UserForm } from '@/components/users/user-form';

import { useAuth } from '@/features/auth/session';
import {
  deleteMe,
  updateMe,
  type UpdateAccountRequest,
} from '@/features/users/api';
import { getUserErrorMessage } from '@/features/users/errors';

export default function ProfileScreen() {
  const { token, user, updateCurrentUser, clearSession } = useAuth();

  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  if (!token || !user) {
    return (
      <View className="flex-1 justify-center bg-background px-5">
        <Text>Authentication required.</Text>
      </View>
    );
  }

  async function saveProfile(changes: UpdateAccountRequest) {
    if (!token) throw new Error('Authentication required.');

    try {
      const updated = await updateMe(token, changes);
      updateCurrentUser(updated);
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
      clearSession();
      router.replace('/register');
    } catch (caught) {
      setError(getUserErrorMessage(caught));
    } finally {
      setDeleting(false);
    }
  }

  function requestDeletion() {
    Alert.alert(
      'Delete account',
      'This action is permanent. Your account will be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () => void confirmDeletion(),
        },
      ],
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 px-5 py-6"
      keyboardShouldPersistTaps="handled"
    >
      <Text variant="h2">My profile</Text>

      <Card>
        <CardHeader>
          <CardTitle>Account information</CardTitle>
        </CardHeader>
        <CardContent className="gap-2">
          <Text>Username: {user.username}</Text>
          <Text>Account ID: {user.id}</Text>
          <Text>Role: {user.role}</Text>
        </CardContent>
      </Card>

      <View className="gap-4">
        <Text variant="h3">Edit account</Text>
        <UserForm
          key={`${user.id}-${user.username}-${user.role}`}
          user={user}
          onSave={saveProfile}
        />
      </View>

      <View className="gap-3 border-t border-border pt-6">
        <Text variant="h3">Danger zone</Text>
        <Text className="text-muted-foreground">
          Deleting your account cannot be undone.
        </Text>

        {error ? (
          <Text accessibilityRole="alert" className="text-destructive">
            {error}
          </Text>
        ) : null}

        <Button
          variant="destructive"
          disabled={deleting}
          accessibilityLabel="Delete my account"
          onPress={requestDeletion}
        >
          {deleting ? <ActivityIndicator /> : <Text>Delete my account</Text>}
        </Button>
      </View>
    </ScrollView>
  );
}
