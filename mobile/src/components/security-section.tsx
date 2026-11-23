import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { FormMessage } from '@/components/ui/feedback';
import { GoogleSignInButton } from '@/components/google-sign-in-button';
import { authenticatedRequest } from '@/lib/api';
import { securityError } from '@/features/auth/google';
import { useAuth } from '@/features/auth/session';
import { useTranslation } from '@/i18n';

interface SecurityStatus {
  password_set: boolean;
  google_linked: boolean;
  two_factor_enabled: boolean;
  recovery_codes_remaining: number;
  google_available: boolean;
  two_factor_available: boolean;
}
export function SecuritySection() {
  const { t } = useTranslation();
  const { clearSession } = useAuth();
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [secret, setSecret] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mustSignIn, setMustSignIn] = useState(false);
  const visibility = useRef(0);
  const load = useCallback(async () => {
    setStatus(
      await authenticatedRequest<SecurityStatus>('/account/security', {}),
    );
  }, []);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void authenticatedRequest<SecurityStatus>('/account/security', {})
        .then((value) => {
          if (active) setStatus(value);
        })
        .catch((caught: unknown) => {
          if (active) setError(securityError(caught));
        });
      return () => {
        active = false;
        visibility.current++;
        setSecret('');
        setCodes([]);
        setCode('');
      };
    }, []),
  );
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        visibility.current++;
        setSecret('');
        setCodes([]);
        setCode('');
        setCopied(false);
      }
    });
    return () => listener.remove();
  }, []);
  async function action(path: string) {
    if (busy) return;
    const visibleAtStart = visibility.current;
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      if (path === '/2fa/setup') {
        const value = await authenticatedRequest<{ secret: string }>(path, {
          method: 'POST',
        });
        if (visibleAtStart === visibility.current) setSecret(value.secret);
      } else if (path === '/2fa/enable' || path === '/2fa/recovery-codes') {
        const value = await authenticatedRequest<{ recovery_codes: string[] }>(
          path,
          {
            method: 'POST',
            body: JSON.stringify({ code: code.trim() }),
          },
        );
        setSecret('');
        if (visibleAtStart === visibility.current)
          setCodes(value.recovery_codes);
        if (path === '/2fa/recovery-codes') setMustSignIn(true);
      } else {
        await authenticatedRequest<void>(path, {
          method: 'POST',
          body: JSON.stringify({ code: code.trim() || undefined }),
        });
        await clearSession();
        return;
      }
      await load();
    } catch (caught) {
      setError(securityError(caught));
    } finally {
      setBusy(false);
      setCode('');
    }
  }
  function confirm(path: string, title: string) {
    Alert.alert(t(title), t('security.confirmChange'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t(title),
        style: 'destructive',
        onPress: () => void action(path),
      },
    ]);
  }
  async function copy(value: string) {
    try {
      await Clipboard.setStringAsync(value, { android: { isSensitive: true } });
      setCopied(true);
    } catch {
      setError('security.failed');
    }
  }
  return (
    <View className="gap-3">
      <Text variant="small" role="heading" aria-level={2}>
        {t('security.title')}
      </Text>
      {error ? <FormMessage>{t(error)}</FormMessage> : null}
      {!status ? (
        <Button
          variant="outline"
          onPress={() =>
            void load().catch((caught) => setError(securityError(caught)))
          }
        >
          <Text>{t('common.retry')}</Text>
        </Button>
      ) : (
        <>
          <Text>
            {t(
              status.google_linked
                ? 'security.googleLinked'
                : 'security.googleUnlinked',
            )}
          </Text>
          {status.google_available && !status.google_linked ? (
            <GoogleSignInButton linking disabled={busy} />
          ) : null}
          <Text>
            {t(
              status.two_factor_enabled
                ? 'security.enabled'
                : 'security.disabled',
            )}
          </Text>
          {status.two_factor_enabled ? (
            <Text>
              {t('security.remaining', {
                count: status.recovery_codes_remaining,
              })}
            </Text>
          ) : null}
          {secret ? (
            <>
              <Text>{t('security.manualHelp')}</Text>
              <Text accessibilityLabel={t('security.setupKey')}>{secret}</Text>
              <Button variant="outline" onPress={() => void copy(secret)}>
                <Text>{t('security.copyKey')}</Text>
              </Button>
            </>
          ) : null}
          {status.two_factor_enabled || secret ? (
            <Input
              accessibilityLabel={t('security.code')}
              placeholder={t('security.code')}
              value={code}
              onChangeText={setCode}
              editable={!busy}
              autoComplete="one-time-code"
              autoCapitalize="none"
              autoCorrect={false}
            />
          ) : null}
          {status.two_factor_available && !status.two_factor_enabled ? (
            <Button
              disabled={busy || Boolean(secret && !code.trim())}
              onPress={() => void action(secret ? '/2fa/enable' : '/2fa/setup')}
            >
              <Text>{t(secret ? 'security.verify' : 'security.setup')}</Text>
            </Button>
          ) : null}
          {status.two_factor_enabled ? (
            <>
              <Button
                variant="outline"
                disabled={busy || !code.trim()}
                onPress={() => confirm('/2fa/disable', 'security.disable')}
              >
                <Text>{t('security.disable')}</Text>
              </Button>
              <Button
                variant="outline"
                disabled={busy || !code.trim()}
                onPress={() =>
                  confirm('/2fa/recovery-codes', 'security.regenerate')
                }
              >
                <Text>{t('security.regenerate')}</Text>
              </Button>
            </>
          ) : null}
          {status.google_linked ? (
            <Button
              variant="outline"
              disabled={
                busy ||
                !status.password_set ||
                (status.two_factor_enabled && !code.trim())
              }
              onPress={() =>
                confirm('/account/google/unlink', 'security.unlinkGoogle')
              }
            >
              <Text>{t('security.unlinkGoogle')}</Text>
            </Button>
          ) : null}
          {status.google_linked && !status.password_set ? (
            <Text>{t('security.passwordFirst')}</Text>
          ) : null}
          {codes.length ? (
            <>
              <Text>{t('security.recoveryHelp')}</Text>
              <Text>{codes.join('\n')}</Text>
              <Button
                variant="outline"
                onPress={() => void copy(codes.join('\n'))}
              >
                <Text>{t('security.copyCodes')}</Text>
              </Button>
              <Button
                onPress={() => {
                  setCodes([]);
                  if (mustSignIn) void clearSession();
                }}
              >
                <Text>{t('security.saved')}</Text>
              </Button>
            </>
          ) : null}
          {mustSignIn && !codes.length ? (
            <Button onPress={() => void clearSession()}>
              <Text>{t('login.submit')}</Text>
            </Button>
          ) : null}
          {copied ? (
            <Text accessibilityLiveRegion="polite">{t('security.copied')}</Text>
          ) : null}
        </>
      )}
    </View>
  );
}
