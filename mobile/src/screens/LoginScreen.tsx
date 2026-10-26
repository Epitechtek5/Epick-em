import { useTranslation } from '@/i18n';
import { Link, Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';

import { useAuth } from '@/features/auth/session';
import { ApiError } from '@/lib/api';
import { AuthHeader } from '@/components/auth-header';

export default function LoginScreen() {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const { signIn, user, initializing } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    if (submitting) return;
    if (!username || !password) {
      setError('login.missing');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await signIn({ username, password });
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 401
          ? 'login.invalid'
          : 'login.failed',
      );
    } finally {
      setSubmitting(false);
    }
  }
  if (user) return <Redirect href="/" />;
  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerClassName="flex-grow justify-center px-6 py-12"
        keyboardShouldPersistTaps="handled"
      >
        <View className="mx-auto w-full max-w-md gap-6">
          <AuthHeader
            title={t('login.title')}
            description={t('login.description')}
          />

          <View className="gap-4">
            <View className="gap-2">
              <Text nativeID="login-username-label">
                {t('common.username')}
              </Text>
              <Input
                accessibilityLabel={t('common.username')}
                accessibilityLabelledBy="login-username-label"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                value={username}
                onChangeText={setUsername}
              />
            </View>

            <View className="gap-2">
              <Text nativeID="login-password-label">
                {t('common.password')}
              </Text>
              <Input
                accessibilityLabel={t('common.password')}
                accessibilityLabelledBy="login-password-label"
                secureTextEntry
                autoComplete="current-password"
                value={password}
                onChangeText={setPassword}
              />
            </View>

            <Button
              disabled={submitting || initializing}
              onPress={() => void submit()}
              accessibilityLabel={t('login.submit')}
            >
              <Text>{t(submitting ? 'login.submitting' : 'login.submit')}</Text>
            </Button>

            {error ? <Text accessibilityRole="alert">{t(error)}</Text> : null}
          </View>

          <View className="flex-row flex-wrap justify-center gap-1">
            <Text className="text-muted-foreground">
              {t('login.noAccount')}
            </Text>
            <Link href="/register">
              <Text className="font-semibold text-primary">
                {t('login.create')}
              </Text>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
