import { AuthScreen } from '@/components/auth-screen';
import { AuthHeader } from '@/components/auth-header';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/i18n';
import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { verifyEmail } from '@/features/auth/verification';
import { ApiError } from '@/lib/api';

export default function VerifyEmailScreen() {
  const { token } = useLocalSearchParams<{ token?: string | string[] }>();
  return (
    <VerificationResult
      key={typeof token === 'string' ? token : 'missing'}
      token={typeof token === 'string' ? token : ''}
    />
  );
}

function VerificationResult({ token }: { token: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(token ? 'loading' : 'invalid');
  const operation = useRef<Promise<void> | null>(null);
  useEffect(() => {
    if (!token) return;
    let active = true;
    operation.current ??= verifyEmail(token);
    operation.current.then(
      () => {
        if (active) setStatus('success');
      },
      (err) => {
        if (active)
          setStatus(
            err instanceof ApiError && err.status === 400
              ? 'invalid'
              : 'failed',
          );
      },
    );
    return () => {
      active = false;
    };
  }, [token]);
  return (
    <AuthScreen>
      <AuthHeader
        title={t('verification.title')}
        description={t('verification.' + status)}
      />
      {status !== 'loading' && status !== 'success' && (
        <Button onPress={() => router.replace('/verification-pending')}>
          <Text>{t('verification.resend')}</Text>
        </Button>
      )}
      <Button onPress={() => router.replace('/login')}>
        <Text>{t('register.login')}</Text>
      </Button>
    </AuthScreen>
  );
}
