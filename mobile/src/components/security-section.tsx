import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Modal, ScrollView, View } from 'react-native';
import ClipboardCopyIcon from '@hugeicons/core-free-icons/ClipboardCopyIcon';
import CheckmarkCircle02Icon from '@hugeicons/core-free-icons/CheckmarkCircle02Icon';
import GoogleIcon from '@hugeicons/core-free-icons/GoogleIcon';
import AlertCircleIcon from '@hugeicons/core-free-icons/AlertCircleIcon';
import Shield01Icon from '@hugeicons/core-free-icons/Shield01Icon';
import { useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { StatusBadge } from '@/components/ui/status-badge';
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
    const visibleAtStart = visibility.current;
    try {
      await Clipboard.setStringAsync(value, { android: { isSensitive: true } });
      if (visibleAtStart === visibility.current) setCopied(true);
    } catch {
      setError('security.failed');
    }
  }
  function closeRecoveryCodes() {
    setCodes([]);
    setCopied(false);
    if (mustSignIn) void clearSession();
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
          {!status.two_factor_enabled ? (
            <View
              className="flex-row items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950"
              accessibilityRole="alert"
            >
              <Icon icon={AlertCircleIcon} tone="foreground" size={20} />
              <Text className="flex-1 text-sm text-amber-800 dark:text-amber-200">
                {t('security.enableReminder')}
              </Text>
            </View>
          ) : null}
          <View className="gap-4 rounded-xl border border-border bg-card p-4">
            <View className="flex-row flex-wrap items-center justify-between gap-3">
              <View className="flex-row items-center gap-2">
                <Icon icon={GoogleIcon} tone="primary" />
                <Text className="font-semibold">Google</Text>
              </View>
              <StatusBadge
                status={status.google_linked ? 'accepted' : 'withdrawn'}
                label={t(
                  status.google_linked
                    ? 'security.googleLinked'
                    : 'security.googleUnlinked',
                )}
              />
            </View>
            <View className="h-px bg-border" />
            <View className="flex-row flex-wrap items-center justify-between gap-3">
              <View className="flex-row items-center gap-2">
                <Icon icon={Shield01Icon} tone="primary" />
                <Text className="font-semibold">{t('security.challenge')}</Text>
              </View>
              <StatusBadge
                status={status.two_factor_enabled ? 'accepted' : 'pending'}
                label={t(
                  status.two_factor_enabled
                    ? 'security.enabled'
                    : 'security.disabled',
                )}
              />
            </View>
            {status.two_factor_enabled ? (
              <Text className="text-sm text-muted-foreground">
                {t('security.remaining', {
                  count: status.recovery_codes_remaining,
                })}
              </Text>
            ) : null}
          </View>
          {status.google_available && !status.google_linked ? (
            <GoogleSignInButton linking disabled={busy} />
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
          <Modal
            visible={codes.length > 0}
            transparent
            animationType="fade"
            onRequestClose={closeRecoveryCodes}
          >
            <View className="flex-1 items-center justify-center bg-black/60 px-5 py-12">
              <View
                className="max-h-[85%] w-full max-w-lg gap-5 rounded-2xl border border-border bg-card p-5"
                accessibilityViewIsModal
                accessibilityLabel={t('security.recoveryTitle')}
              >
                <View className="flex-row items-center gap-3">
                  <View className="rounded-xl bg-violet-100 p-3 dark:bg-violet-950">
                    <Icon icon={Shield01Icon} tone="primary" size={26} />
                  </View>
                  <View className="flex-1 gap-1">
                    <Text className="text-lg font-bold" role="heading">
                      {t('security.recoveryTitle')}
                    </Text>
                    <Text className="text-xs font-semibold text-primary">
                      {t('security.oneTimeDisplay')}
                    </Text>
                  </View>
                  <Button
                    size="icon"
                    accessibilityLabel={t('security.copyCodes')}
                    onPress={() => void copy(codes.join('\n'))}
                  >
                    <Icon
                      icon={copied ? CheckmarkCircle02Icon : ClipboardCopyIcon}
                      tone="primary-foreground"
                    />
                  </Button>
                </View>
                <ScrollView contentContainerClassName="gap-4" bounces={false}>
                  <Text className="text-sm text-muted-foreground">
                    {t('security.recoveryHelp')}
                  </Text>
                  <View className="flex-row flex-wrap justify-between gap-y-2">
                    {codes.map((recoveryCode) => (
                      <View
                        key={recoveryCode}
                        className="w-[48%] rounded-lg border border-violet-200 bg-violet-50 px-2 py-3 dark:border-violet-800 dark:bg-violet-950"
                      >
                        <Text className="text-center font-mono text-sm font-semibold">
                          {recoveryCode}
                        </Text>
                      </View>
                    ))}
                  </View>
                  {copied ? (
                    <Text
                      className="text-sm font-medium text-primary"
                      accessibilityLiveRegion="polite"
                    >
                      {t('security.copied')}
                    </Text>
                  ) : null}
                  {error ? <FormMessage>{t(error)}</FormMessage> : null}
                </ScrollView>
                <Button onPress={closeRecoveryCodes}>
                  <Text>{t('security.saved')}</Text>
                </Button>
              </View>
            </View>
          </Modal>
          {mustSignIn && !codes.length ? (
            <Button onPress={() => void clearSession()}>
              <Text>{t('login.submit')}</Text>
            </Button>
          ) : null}
          {copied && !codes.length ? (
            <Text accessibilityLiveRegion="polite">{t('security.copied')}</Text>
          ) : null}
        </>
      )}
    </View>
  );
}
