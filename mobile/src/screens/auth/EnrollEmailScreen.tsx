import { AuthScreen } from '@/components/auth-screen';
import { AuthHeader } from '@/components/auth-header';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/i18n';
import { useState } from 'react';
import { router } from 'expo-router';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { FormMessage } from '@/components/ui/feedback';
import { normalizeEmail, validateEmail } from '@/features/auth/validation';
import { enrollEmail } from '@/features/auth/verification';
import { ApiError } from '@/lib/api';

export default function EnrollEmailScreen() {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    if (busy) return;
    if (validateEmail(email)) {
      setError('validation.email');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await enrollEmail(username.trim(), password, normalizeEmail(email));
      setPassword('');
      router.replace({
        pathname: '/verification-pending',
        params: { email: normalizeEmail(email), cooldown: '1' },
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'email_taken') {
        setError('errors.emailConflict');
        return;
      }
      setError(
        err instanceof ApiError && err.status === 401
          ? 'verification.denied'
          : 'verification.failed',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthScreen>
      <AuthHeader
        title={t('verification.enroll')}
        description={t('verification.legacy')}
      />
      <Input
        accessibilityLabel={t('common.username')}
        placeholder={t('common.username')}
        autoCapitalize="none"
        value={username}
        onChangeText={setUsername}
      />
      <Input
        accessibilityLabel={t('common.email')}
        placeholder={t('common.email')}
        keyboardType="email-address"
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
      />
      <PasswordInput
        accessibilityLabel={t('common.password')}
        placeholder={t('common.password')}
        value={password}
        onChangeText={setPassword}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />
      <Button
        disabled={busy || !username || !password}
        onPress={() => void submit()}
      >
        <Text>{t('verification.enroll')}</Text>
      </Button>
      {error && <FormMessage>{t(error)}</FormMessage>}
      <Button onPress={() => router.replace('/login')}>
        <Text>{t('register.login')}</Text>
      </Button>
    </AuthScreen>
  );
}
