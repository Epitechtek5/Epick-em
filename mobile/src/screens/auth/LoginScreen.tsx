import { AuthScreen } from '@/components/auth-screen';
import { PasswordInput } from '@/components/ui/password-input';
import { FormMessage } from '@/components/ui/feedback';
import { useTranslation } from '@/i18n';
import { Link, Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';

import { useAuth } from '@/features/auth/session';
import { ApiError } from '@/lib/api';
import { AuthHeader } from '@/components/auth-header';
import { normalizeEmail, validateEmail } from '@/features/auth/validation';

export default function LoginScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const { signIn, user, initializing } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    if (submitting) return;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password) {
      setError('login.missing');
      return;
    }
    if (validateEmail(normalizedEmail)) {
      setError('validation.email');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await signIn({ email: normalizedEmail, password });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'email_unverified') {
        router.replace({
          pathname: '/verification-pending',
          params: { email: normalizedEmail },
        });
        return;
      }
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
          <Text className="text-sm font-medium" nativeID="login-email-label">
            {t('common.email')}
          </Text>
          <Input
            accessibilityLabel={t('common.email')}
            accessibilityLabelledBy="login-email-label"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              setError('');
            }}
            editable={!submitting}
            invalid={
              error === 'login.invalid' || (error === 'login.missing' && !email)
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
          <Link href="/enroll-email">
            <Text>{t('verification.enroll')}</Text>
          </Link>
          <Link href="/forgot-password" className="self-end">
            <Text className="text-sm font-semibold text-primary">
              {t('login.forgotPassword')}
            </Text>
          </Link>
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
