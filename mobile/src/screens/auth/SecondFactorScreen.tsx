import { useState } from 'react';
import { Redirect, router } from 'expo-router';
import { View } from 'react-native';
import { AuthScreen } from '@/components/auth-screen';
import { AuthHeader } from '@/components/auth-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { FormMessage } from '@/components/ui/feedback';
import { useAuth } from '@/features/auth/session';
import { securityError } from '@/features/auth/google';
import { useInvitationReturn } from '@/features/invitations/navigation';
import { useTranslation } from '@/i18n';

export default function SecondFactorScreen() {
  const { t } = useTranslation();
  const { target } = useInvitationReturn();
  const { user, secondFactorRequired, verifySecondFactor, clearSession } =
    useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    if (busy || !code.trim()) return;
    setBusy(true);
    setError('');
    try {
      await verifySecondFactor(code);
    } catch (caught) {
      setError(securityError(caught));
    } finally {
      setBusy(false);
      setCode('');
    }
  }
  if (user) return <Redirect href={target ?? '/'} />;
  return (
    <AuthScreen>
      <AuthHeader
        title={t('security.challenge')}
        description={t('security.challengeHelp')}
      />
      <View className="gap-4">
        {secondFactorRequired ? (
          <>
            <Input
              accessibilityLabel={t('security.code')}
              value={code}
              onChangeText={setCode}
              autoComplete="one-time-code"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />
            <Button
              disabled={busy || !code.trim()}
              onPress={() => void submit()}
            >
              <Text>{t('security.verify')}</Text>
            </Button>
          </>
        ) : (
          <FormMessage>{t('security.errors.challenge_expired')}</FormMessage>
        )}
        {error ? <FormMessage>{t(error)}</FormMessage> : null}
        <Button
          variant="outline"
          onPress={() =>
            void clearSession().then(() => router.replace('/login'))
          }
        >
          <Text>{t('common.cancel')}</Text>
        </Button>
      </View>
    </AuthScreen>
  );
}
