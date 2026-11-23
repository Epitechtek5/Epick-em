import { useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { FormMessage } from '@/components/ui/feedback';
import { useAuth } from '@/features/auth/session';
import { startGoogle, securityError } from '@/features/auth/google';
import { useTranslation } from '@/i18n';

export function GoogleSignInButton({
  disabled = false,
  linking = false,
}: {
  disabled?: boolean;
  linking?: boolean;
}) {
  const { t } = useTranslation();
  const { user, clearSession } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function start() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (!linking) await clearSession();
      const callback = await startGoogle(linking ? (user?.id ?? null) : null);
      if (callback)
        router.replace({
          pathname: '/auth/google/callback',
          params: { callback },
        });
    } catch (caught) {
      setError(securityError(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View className="gap-2">
      <Button
        variant="outline"
        disabled={disabled || busy}
        onPress={() => void start()}
        accessibilityLabel={t(
          linking ? 'security.linkGoogle' : 'security.google',
        )}
      >
        <Text>
          {t(
            busy
              ? 'common.loading'
              : linking
                ? 'security.linkGoogle'
                : 'security.google',
          )}
        </Text>
      </Button>
      {error ? <FormMessage>{t(error)}</FormMessage> : null}
    </View>
  );
}
