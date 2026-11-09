import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { AuthHeader } from '@/components/auth-header';
import { AuthScreen } from '@/components/auth-screen';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/feedback';
import { PasswordInput } from '@/components/ui/password-input';
import { Text } from '@/components/ui/text';
import { resetPassword } from '@/features/auth/recovery';
import { useAuth } from '@/features/auth/session';
import { validateNewPassword } from '@/features/auth/validation';
import { useTranslation } from '@/i18n';
import { ApiError } from '@/lib/api';

export function parseResetToken(
  value: string | string[] | undefined,
): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = parseResetToken(params.token);

  return <ResetPasswordContent key={token ?? 'missing'} token={token} />;
}

function ResetPasswordContent({ token }: { token: string | null }) {
  const { t } = useTranslation();
  const { clearSession } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  async function submit() {
    if (!token || submitting) return;
    const passwordError = validateNewPassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (password !== confirmation) {
      setError('validation.match');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await resetPassword(token, password);
      await clearSession();
      setPassword('');
      setConfirmation('');
      setSucceeded(true);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === 'invalid_reset_token'
          ? 'recovery.invalidToken'
          : 'recovery.resetFailed',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!token || error === 'recovery.invalidToken') {
    return (
      <AuthScreen>
        <AuthHeader
          title={t('recovery.invalidTitle')}
          description={t('recovery.invalidToken')}
        />
        <Button onPress={() => router.replace('/forgot-password')}>
          <Text>{t('recovery.requestAnother')}</Text>
        </Button>
        <Button variant="ghost" onPress={() => router.replace('/login')}>
          <Text>{t('recovery.backToLogin')}</Text>
        </Button>
      </AuthScreen>
    );
  }

  if (succeeded) {
    return (
      <AuthScreen>
        <AuthHeader
          title={t('recovery.successTitle')}
          description={t('recovery.successDescription')}
        />
        <Button onPress={() => router.replace('/login')}>
          <Text>{t('recovery.backToLogin')}</Text>
        </Button>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <AuthHeader
        title={t('recovery.resetTitle')}
        description={t('recovery.resetDescription')}
      />
      <View className="gap-5">
        <View className="gap-2">
          <Text className="text-sm font-medium" nativeID="reset-password-label">
            {t('common.newPassword')}
          </Text>
          <PasswordInput
            accessibilityLabel={t('common.newPassword')}
            accessibilityLabelledBy="reset-password-label"
            autoComplete="new-password"
            value={password}
            editable={!submitting}
            invalid={Boolean(error)}
            onChangeText={(value) => {
              setPassword(value);
              setError('');
            }}
          />
        </View>
        <View className="gap-2">
          <Text className="text-sm font-medium" nativeID="reset-confirm-label">
            {t('common.confirmPassword')}
          </Text>
          <PasswordInput
            accessibilityLabel={t('common.confirmPassword')}
            accessibilityLabelledBy="reset-confirm-label"
            autoComplete="new-password"
            value={confirmation}
            editable={!submitting}
            invalid={error === 'validation.match'}
            onChangeText={(value) => {
              setConfirmation(value);
              setError('');
            }}
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
          />
        </View>
        {error ? <FormMessage>{t(error)}</FormMessage> : null}
        <Button
          disabled={submitting}
          onPress={() => void submit()}
          accessibilityLabel={t('recovery.resetSubmit')}
        >
          {submitting ? (
            <ActivityIndicator accessibilityLabel={t('common.loading')} />
          ) : null}
          <Text>{t('recovery.resetSubmit')}</Text>
        </Button>
      </View>
      <Button variant="ghost" onPress={() => router.replace('/login')}>
        <Text>{t('recovery.backToLogin')}</Text>
      </Button>
    </AuthScreen>
  );
}
