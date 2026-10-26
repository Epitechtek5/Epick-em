import { AuthScreen } from '@/components/auth-screen';
import { PasswordInput } from '@/components/ui/password-input';
import { FormMessage } from '@/components/ui/feedback';
import { useTranslation } from '@/i18n';
import { Link, Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

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
    <AuthScreen>
      <AuthHeader
        title={t('login.title')}
        description={t('login.description')}
      />

      <View className="gap-5">
        <View className="gap-2">
          <Text className="text-sm font-medium" nativeID="login-username-label">
            {t('common.username')}
          </Text>
          <Input
            accessibilityLabel={t('common.username')}
            accessibilityLabelledBy="login-username-label"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            value={username}
            onChangeText={(value) => {
              setUsername(value);
              setError('');
            }}
            editable={!submitting}
            invalid={
              error === 'login.invalid' ||
              (error === 'login.missing' && !username)
            }
          />
        </View>

        <View className="gap-2">
          <Text className="text-sm font-medium" nativeID="login-password-label">
            {t('common.password')}
          </Text>
          <PasswordInput
            accessibilityLabel={t('common.password')}
            accessibilityLabelledBy="login-password-label"
            autoComplete="current-password"
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              setError('');
            }}
            editable={!submitting}
            invalid={
              error === 'login.invalid' ||
              (error === 'login.missing' && !password)
            }
            returnKeyType="go"
            onSubmitEditing={() => {
              if (!initializing) void submit();
            }}
          />
        </View>

        <Button
          disabled={submitting || initializing}
          onPress={() => void submit()}
          accessibilityLabel={t('login.submit')}
        >
          {submitting ? (
            <ActivityIndicator accessibilityLabel={t('login.submitting')} />
          ) : null}
          <Text>{t(submitting ? 'login.submitting' : 'login.submit')}</Text>
        </Button>

        {error ? <FormMessage>{t(error)}</FormMessage> : null}
      </View>

      <View className="flex-row flex-wrap justify-center gap-1">
        <Text className="text-sm text-muted-foreground">
          {t('login.noAccount')}
        </Text>
        <Link href="/register">
          <Text className="font-semibold text-primary">
            {t('login.create')}
          </Text>
        </Link>
      </View>
    </AuthScreen>
  );
}
