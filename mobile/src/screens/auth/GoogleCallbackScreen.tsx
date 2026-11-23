import { useEffect, useRef, useState } from 'react';
import { useURL } from 'expo-linking';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { AuthScreen } from '@/components/auth-screen';
import { AuthHeader } from '@/components/auth-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { FormMessage } from '@/components/ui/feedback';
import { useAuth } from '@/features/auth/session';
import { consumeGoogle, securityError } from '@/features/auth/google';
import type { LoginResponse } from '@/features/auth/types';
import { apiRequest, authenticatedRequest } from '@/lib/api';
import { useTranslation } from '@/i18n';

export default function GoogleCallbackScreen() {
  const { t } = useTranslation();
  const url = useURL();
  const { callback } = useLocalSearchParams<{ callback?: string }>();
  const { user, initializing, secondFactorRequired, completeGoogle } =
    useAuth();
  const started = useRef(false);
  const linkingAccount = useRef<string | null>(null);
  const [link, setLink] = useState<{ code: string; state: string } | null>(
    null,
  );
  const [factor, setFactor] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const incoming = callback ?? url;
    if (initializing || !incoming || started.current) return;
    started.current = true;
    void consumeGoogle(incoming, user?.id ?? null)
      .then(async (result) => {
        if (result.linking) {
          linkingAccount.current = user?.id ?? null;
          setLink({ code: result.code, state: result.state });
          return;
        }
        await completeGoogle(() =>
          apiRequest<LoginResponse>('/auth/google/callback', {
            method: 'POST',
            body: JSON.stringify({ code: result.code, state: result.state }),
          }),
        );
        setDone(true);
      })
      .catch((caught: unknown) => setError(securityError(caught)));
  }, [callback, url, initializing, user?.id, completeGoogle]);
  async function submitLink() {
    if (!link || busy) return;
    if (!user || linkingAccount.current !== user.id) {
      setLink(null);
      setError('security.errors.invalid_oauth_state');
      return;
    }
    setBusy(true);
    try {
      await authenticatedRequest('/account/google/link', {
        method: 'POST',
        body: JSON.stringify({
          ...link,
          second_factor: factor.trim() || undefined,
        }),
      });
      setLink(null);
      setDone(true);
    } catch (caught) {
      setLink(null); // The backend consumes OAuth state even if linking fails.
      setError(securityError(caught));
    } finally {
      setBusy(false);
      setFactor('');
    }
  }
  if (secondFactorRequired) return <Redirect href="/second-factor" />;
  if (done) return <Redirect href={user ? '/' : '/login'} />;
  return (
    <AuthScreen>
      <AuthHeader
        title={t('security.google')}
        description={t('security.callbackHelp')}
      />
      <View className="gap-4">
        {link ? (
          <>
            <Input
              accessibilityLabel={t('security.code')}
              placeholder={t('security.optionalCode')}
              value={factor}
              onChangeText={setFactor}
              autoComplete="one-time-code"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Button disabled={busy} onPress={() => void submitLink()}>
              <Text>{t('security.linkGoogle')}</Text>
            </Button>
          </>
        ) : !error ? (
          <Text>{t('common.loading')}</Text>
        ) : null}
        {error ? <FormMessage>{t(error)}</FormMessage> : null}
        <Button
          variant="outline"
          onPress={() => router.replace(user ? '/' : '/login')}
        >
          <Text>{t('common.cancel')}</Text>
        </Button>
      </View>
    </AuthScreen>
  );
}
