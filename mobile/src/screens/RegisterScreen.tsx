import { AuthScreen } from '@/components/auth-screen';
import { PasswordInput } from '@/components/ui/password-input';
import { FormMessage } from '@/components/ui/feedback';
import { useTranslation } from '@/i18n';
import { Link, Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Card, CardContent } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import CheckmarkCircle02Icon from '@hugeicons/core-free-icons/CheckmarkCircle02Icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/features/auth/session';
import { ApiError } from '@/lib/api';
import { register } from '@/features/auth/register';
import {
  validateRegisterForm,
  type RegisterErrors,
  type RegisterForm,
} from '@/features/auth/validation';

import { AuthHeader } from '@/components/auth-header';

const INITIAL_FORM: RegisterForm = {
  username: '',
  password: '',
  confirmPassword: '',
};

export default function RegisterScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [form, setForm] = useState<RegisterForm>(INITIAL_FORM);
  const [errors, setErrors] = useState<RegisterErrors>({});
  const [serverError, setServerError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [created, setCreated] = useState(false);

  function updateField(field: keyof RegisterForm, value: string) {
    setForm((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setServerError('');
  }

  async function handleSubmit() {
    if (isSubmitting) return;

    const validationErrors = validateRegisterForm(form);
    setErrors(validationErrors);
    setServerError('');

    if (Object.keys(validationErrors).length > 0) return;

    setIsSubmitting(true);

    try {
      await register({
        username: form.username,
        password: form.password,
      });

      setCreated(true);
      setForm(INITIAL_FORM);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setErrors({ username: 'errors.conflict' });
      } else if (error instanceof ApiError) {
        setServerError(
          error.status === 400 ? 'errors.invalid' : 'register.failed',
        );
      } else {
        setServerError('register.failed');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (user) return <Redirect href="/" />;

  return (
    <AuthScreen>
      <AuthHeader
        title={t(created ? 'register.completeTitle' : 'register.title')}
        description={t(
          created ? 'register.completeDescription' : 'register.description',
        )}
      />

      {created ? (
        <Card>
          <CardContent className="gap-5">
            <View className="items-center">
              <View className="h-14 w-14 items-center justify-center rounded-lg bg-muted">
                <Icon icon={CheckmarkCircle02Icon} tone="primary" size={30} />
              </View>
            </View>
            <Text
              accessibilityRole="alert"
              className="text-center text-foreground"
            >
              {t('register.success')}
            </Text>
            <Text className="text-center text-muted-foreground">
              {t('register.explanation')}
            </Text>
            <Link href="/login" asChild>
              <Button>
                <Text>{t('register.login')}</Text>
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <View className="gap-5">
          <View className="gap-2">
            <Text
              className="text-sm font-medium"
              nativeID="register-username-label"
            >
              {t('common.username')}
            </Text>
            <Input
              accessibilityLabel={t('common.username')}
              accessibilityLabelledBy="register-username-label"
              invalid={Boolean(errors.username)}
              accessibilityHint={t('common.usernameHint')}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username-new"
              value={form.username}
              onChangeText={(value) => updateField('username', value)}
              editable={!isSubmitting}
            />
            {errors.username && <FormMessage>{t(errors.username)}</FormMessage>}
          </View>

          <View className="gap-2">
            <Text
              className="text-sm font-medium"
              nativeID="register-password-label"
            >
              {t('common.password')}
            </Text>
            <PasswordInput
              accessibilityLabel={t('common.password')}
              accessibilityLabelledBy="register-password-label"
              invalid={Boolean(errors.password)}
              autoCapitalize="none"
              autoComplete="new-password"
              value={form.password}
              onChangeText={(value) => updateField('password', value)}
              editable={!isSubmitting}
            />
            {errors.password && <FormMessage>{t(errors.password)}</FormMessage>}
          </View>

          <View className="gap-2">
            <Text
              className="text-sm font-medium"
              nativeID="register-confirm-label"
            >
              {t('common.confirmPassword')}
            </Text>
            <PasswordInput
              accessibilityLabel={t('common.confirmPassword')}
              accessibilityLabelledBy="register-confirm-label"
              invalid={Boolean(errors.confirmPassword)}
              autoCapitalize="none"
              autoComplete="new-password"
              value={form.confirmPassword}
              onChangeText={(value) => updateField('confirmPassword', value)}
              editable={!isSubmitting}
            />
            {errors.confirmPassword && (
              <FormMessage>{t(errors.confirmPassword)}</FormMessage>
            )}
          </View>

          {serverError ? <FormMessage>{t(serverError)}</FormMessage> : null}

          <Button
            onPress={handleSubmit}
            disabled={isSubmitting}
            accessibilityLabel={t('register.submit')}
          >
            {isSubmitting ? (
              <ActivityIndicator accessibilityLabel={t('common.loading')} />
            ) : (
              <Text>{t('register.submit')}</Text>
            )}
          </Button>
        </View>
      )}

      <View className="flex-row flex-wrap justify-center gap-1">
        <Text className="text-sm text-muted-foreground">
          {t('register.hasAccount')}
        </Text>
        <Link href="/login">
          <Text className="font-semibold text-primary">
            {t('login.submit')}
          </Text>
        </Link>
      </View>
    </AuthScreen>
  );
}
