import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Link } from 'expo-router';

import { AuthHeader } from '@/components/auth-header';
import { AuthScreen } from '@/components/auth-screen';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { forgotPassword } from '@/features/auth/recovery';
import { normalizeEmail, validateEmail } from '@/features/auth/validation';
import { useTranslation } from '@/i18n';

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function submit() {
    if (submitting) return;
    const normalized = normalizeEmail(email);
    const validation = validateEmail(normalized);
    if (validation) {
      setError(validation);
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await forgotPassword(normalized);
      setSubmitted(true);
    } catch {
      setError('recovery.requestFailed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthScreen>
      <AuthHeader
        title={t('recovery.forgotTitle')}
        description={t('recovery.forgotDescription')}
      />

      {submitted ? (
        <View className="gap-5">
          <FormMessage success>{t('recovery.neutralConfirmation')}</FormMessage>
          <Button variant="outline" onPress={() => setSubmitted(false)}>
            <Text>{t('common.retry')}</Text>
          </Button>
        </View>
      ) : (
        <View className="gap-5">
          <View className="gap-2">
            <Text className="text-sm font-medium" nativeID="forgot-email-label">
              {t('common.email')}
            </Text>
            <Input
              accessibilityLabel={t('common.email')}
              accessibilityLabelledBy="forgot-email-label"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              invalid={Boolean(error)}
              editable={!submitting}
              onChangeText={(value) => {
                setEmail(value);
                setError('');
              }}
              returnKeyType="send"
              onSubmitEditing={() => void submit()}
            />
            {error ? <FormMessage>{t(error)}</FormMessage> : null}
          </View>
          <Button
            disabled={submitting}
            onPress={() => void submit()}
            accessibilityLabel={t('recovery.sendLink')}
          >
            {submitting ? (
              <ActivityIndicator accessibilityLabel={t('common.loading')} />
            ) : null}
            <Text>{t('recovery.sendLink')}</Text>
          </Button>
        </View>
      )}

      <Link href="/login" asChild>
        <Button variant="ghost">
          <Text>{t('recovery.backToLogin')}</Text>
        </Button>
      </Link>
    </AuthScreen>
  );
}
