import { AuthScreen } from '@/components/auth-screen';
import { AuthHeader } from '@/components/auth-header';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/i18n';
import { useState, useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Input } from '@/components/ui/input';
import { FormMessage } from '@/components/ui/feedback';
import { normalizeEmail, validateEmail } from '@/features/auth/validation';
import { resendVerification } from '@/features/auth/verification';

export default function VerificationPendingScreen() {
  const params = useLocalSearchParams<{ email?: string; cooldown?: string }>();
  const { t } = useTranslation();
  const [email, setEmail] = useState(params.email ?? '');
  const [wait, setWait] = useState(params.cooldown ? 60 : 0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);
  async function resend() {
    if (wait || busy) return;
    if (validateEmail(email)) {
      setMessage('validation.email');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await resendVerification(normalizeEmail(email));
      setWait(60);
      setMessage('verification.sent');
    } catch {
      setMessage('verification.failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthScreen>
      <AuthHeader
        title={t('verification.pending')}
        description={t('verification.instructions')}
      />
      <Input
        accessibilityLabel={t('common.email')}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        returnKeyType="go"
        onSubmitEditing={() => void resend()}
      />
      <Button disabled={busy || wait > 0} onPress={() => void resend()}>
        <Text>
          {t('verification.resend')}
          {wait > 0 ? ` (${wait})` : ''}
        </Text>
      </Button>
      {message && <FormMessage>{t(message)}</FormMessage>}
      <Button onPress={() => router.replace('/login')}>
        <Text>{t('register.login')}</Text>
      </Button>
    </AuthScreen>
  );
}
